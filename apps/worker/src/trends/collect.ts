import { TrendSignal } from "@shortloop/contracts";
import { type Db, insertSignals, pruneSignals } from "@shortloop/db";
import type { JobHandler } from "@shortloop/pipeline";
import type { TrendCollector } from "@shortloop/providers";

/** Input of one hourly `trends` job: a region (or `global` for niche feeds) and the YouTube categories. */
export interface TrendsJobInput {
  region: string;
  categoryIds: string[];
  /** ISO hour this run belongs to (part of the idempotency key). */
  hour: string;
}

export interface TrendsHandlerOptions {
  now?: () => Date;
}

/**
 * The `trends` stage (E3-01): run every collector for the job's scope, store the signals
 * (idempotently), then prune signals older than 30 days. One collector failing doesn't lose the
 * others' signals; the job fails (and retries) only when every collector failed.
 */
export function trendsHandler(
  db: Db,
  collectors: readonly TrendCollector[],
  opts: TrendsHandlerOptions = {},
): JobHandler {
  return async ({ job, onProgress }) => {
    const input = job.input as Partial<TrendsJobInput>;
    const region = String(input.region ?? "");
    const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.map(String) : [];
    const scope = region === "global" ? "global" : "region";
    const active = collectors.filter((c) => c.scope === scope);
    const signals: TrendSignal[] = [];
    const bySource: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let done = 0;
    for (const c of active) {
      try {
        const got = await c.collect(region, categoryIds);
        const valid = got.filter((s) => TrendSignal.safeParse(s).success);
        signals.push(...valid);
        bySource[c.source] = valid.length;
      } catch (err) {
        errors[c.source] = err instanceof Error ? err.message : String(err);
        console.warn(`trends ${region}: ${c.source} failed: ${errors[c.source]}`);
      }
      await onProgress((++done / (active.length + 1)) * 0.9);
    }
    if (active.length > 0 && Object.keys(errors).length === active.length) {
      throw new Error(`every trend collector failed for ${region}: ${JSON.stringify(errors)}`);
    }
    const inserted = await insertSignals(db, signals);
    const pruned = await pruneSignals(db, opts.now?.() ?? new Date());
    return { region, collected: signals.length, inserted, pruned, bySource, errors };
  };
}
