import type { TrendSignal } from "@shortloop/contracts";
import { type TrendCollector, trendSignalId } from "./collector";

/** Deterministic collector for tests: returns `count` signals per category (or one per run when global). */
export class FakeTrendCollector implements TrendCollector {
  readonly calls: { region: string; categoryIds: readonly string[] }[] = [];

  constructor(
    readonly source: TrendSignal["source"] = "youtube_popular",
    readonly scope: "region" | "global" = "region",
    private readonly opts: { count?: number; fail?: boolean; now?: () => Date } = {},
  ) {}

  async collect(region: string, categoryIds: readonly string[]): Promise<TrendSignal[]> {
    this.calls.push({ region, categoryIds });
    if (this.opts.fail) throw new Error(`fake ${this.source} collector failed`);
    const observedAt = (this.opts.now?.() ?? new Date()).toISOString();
    const cats: (string | undefined)[] =
      this.source === "youtube_popular" && categoryIds.length ? [...categoryIds] : [undefined];
    return cats.flatMap((categoryId) =>
      Array.from({ length: this.opts.count ?? 2 }, (_, i) => {
        const base = {
          source: this.source,
          region: region as TrendSignal["region"],
          ...(categoryId ? { categoryId } : {}),
          title: `Fake ${this.source} topic ${i + 1}${categoryId ? ` (cat ${categoryId})` : ""}`,
          observedAt,
        };
        return { ...base, id: trendSignalId(base), keywords: ["fake", "topic"], metric: 100 - i };
      }),
    );
  }
}
