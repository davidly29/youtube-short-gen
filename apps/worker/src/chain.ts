import type { CaptionStyleId, CaptionWord } from "@shortloop/contracts";
import { schema, eq, type Db } from "@shortloop/db";
import { refund, reserve, type JobHandler, type JobService } from "@shortloop/pipeline";

/** Carried from stage to stage when a user clicks "Make my Short". */
export interface ProductionChain {
  projectId: string;
  captionStyle: CaptionStyleId;
  imageStyle?: string;
  libraryAssetIds?: string[];
  musicAssetId?: string;
  /** The job whose ledger rows hold the Short credit for this production (set by the voice stage). */
  creditJobId?: string;
}

type ProjectStatus = (typeof schema.projects.$inferInsert)["status"];

export async function setProject(
  db: Db,
  projectId: string,
  patch: Partial<{
    status: ProjectStatus;
    scriptId: string;
    timelineId: string;
    renderAssetId: string;
    lastJobId: string;
    error: string | null;
  }>,
): Promise<void> {
  await db
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));
}

/**
 * Wraps stage handlers so a production runs voice -> visuals -> render on its own, keeps the
 * project's status current, and returns the reserved credit if any stage finally fails.
 */
export function withProduction(
  db: Db,
  jobs: () => JobService,
  stage: "script" | "voice" | "visuals" | "render",
  handler: JobHandler,
): JobHandler {
  return async (ctx) => {
    const input = ctx.job.input as { projectId?: string; chain?: ProductionChain; scriptId?: string };
    const projectId = input.chain?.projectId ?? input.projectId;
    if (projectId) {
      await setProject(db, projectId, {
        status: stage === "script" ? "scripting" : "producing",
        lastJobId: ctx.job.id,
        error: null,
      });
    }
    let chain = input.chain;
    if (stage === "voice" && chain && !chain.creditJobId) {
      // One Short credit per production, reserved atomically here (retries don't double-reserve).
      const held = await db.query.creditLedger.findFirst({
        where: eq(schema.creditLedger.jobId, ctx.job.id),
      });
      if (!held) await reserve(db, ctx.ownerId, { short: 1 }, ctx.job.id);
      chain = { ...chain, creditJobId: ctx.job.id };
    }
    const output = await handler(ctx);
    if (stage === "script" && projectId) {
      await setProject(db, projectId, { status: "script_ready", scriptId: output.scriptId as string });
    }
    if (stage === "voice" && chain && input.scriptId) {
      await jobs().enqueue(
        "visuals",
        {
          scriptId: input.scriptId,
          voice: {
            audioAssetId: output.audioAssetId as string,
            durationMs: output.durationMs as number,
            words: output.words as CaptionWord[],
          },
          captionStyle: chain.captionStyle,
          imageStyle: chain.imageStyle,
          libraryAssetIds: chain.libraryAssetIds,
          musicAssetId: chain.musicAssetId,
          chain,
        },
        { idempotencyKey: `visuals:${ctx.job.id}`, ownerId: ctx.ownerId },
      );
    }
    if (stage === "visuals" && chain) {
      await setProject(db, chain.projectId, { timelineId: output.timelineId as string });
      await jobs().enqueue(
        "render",
        { timelineId: output.timelineId, chain },
        { idempotencyKey: `render:${output.timelineId as string}`, ownerId: ctx.ownerId },
      );
    }
    if (stage === "render" && projectId) {
      await setProject(db, projectId, { status: "ready", renderAssetId: output.videoAssetId as string });
    }
    return output;
  };
}

/** On a stage's final failure: mark the project failed and give the reserved credit back. */
export function productionFailureListener(db: Db) {
  return async (job: { id: string; type: string; input: Record<string, unknown>; error?: string }) => {
    const chain = job.input.chain as ProductionChain | undefined;
    const projectId = chain?.projectId ?? (job.input.projectId as string | undefined);
    const creditJobId = chain?.creditJobId ?? (chain && job.type === "voice" ? job.id : undefined);
    if (creditJobId) await refund(db, creditJobId);
    if (projectId) await setProject(db, projectId, { status: "failed", error: job.error ?? "failed" });
  };
}
