import { rankPortraitFirst, type StockProvider, type StockQuery, type StockResult } from "./stock";

/** Deterministic stock catalogue for tests: one portrait and one landscape result per query. */
export class FakeStock implements StockProvider {
  readonly provider = "fake-stock";
  readonly queries: StockQuery[] = [];

  async search(q: StockQuery): Promise<StockResult[]> {
    this.queries.push(q);
    const slug = q.query.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const make = (n: number, width: number, height: number): StockResult => ({
      provider: this.provider,
      providerId: `${slug}-${n}`,
      kind: q.kind,
      downloadUrl: `https://stock.example/${slug}-${n}.${q.kind === "video" ? "mp4" : "jpg"}`,
      previewUrl: `https://stock.example/${slug}-${n}-preview.jpg`,
      pageUrl: `https://stock.example/${slug}-${n}`,
      width,
      height,
      durationMs: q.kind === "video" ? 8000 : undefined,
      author: "Test Author",
      licenceUrl: "https://stock.example/licence",
      attribution: "Photo by Test Author on FakeStock",
      needsCrop: false,
    });
    return rankPortraitFirst([make(1, 1920, 1080), make(2, 1080, 1920)]);
  }
}
