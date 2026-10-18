import { rankPortraitFirst, type StockProvider, type StockQuery, type StockResult } from "./stock";

const LICENCE = "https://pixabay.com/service/license-summary/";

interface PixabayHit {
  id: number;
  pageURL: string;
  user: string;
  imageWidth?: number;
  imageHeight?: number;
  largeImageURL?: string;
  webformatURL?: string;
  duration?: number;
  videos?: Record<string, { url: string; width: number; height: number; thumbnail?: string }>;
}

export class PixabayStock implements StockProvider {
  readonly provider = "pixabay";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(q: StockQuery): Promise<StockResult[]> {
    const base = q.kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
    const params = new URLSearchParams({
      key: this.apiKey,
      q: q.query,
      per_page: String(q.perPage ?? 15),
      safesearch: "true",
    });
    if (q.kind === "image") params.set("orientation", "vertical");
    const res = await this.fetchImpl(`${base}?${params}`);
    if (!res.ok) throw new Error(`Pixabay ${res.status}`);
    const data = (await res.json()) as { hits: PixabayHit[] };
    const results: StockResult[] = data.hits.flatMap((h): StockResult[] => {
      if (q.kind === "video") {
        const v = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
        if (!v?.url || (q.minDurationMs && (h.duration ?? 0) * 1000 < q.minDurationMs)) return [];
        return [
          {
            provider: this.provider,
            providerId: String(h.id),
            kind: "video" as const,
            downloadUrl: v.url,
            previewUrl: v.thumbnail ?? "",
            pageUrl: h.pageURL,
            width: v.width,
            height: v.height,
            durationMs: (h.duration ?? 0) * 1000,
            author: h.user,
            licenceUrl: LICENCE,
            attribution: `Video by ${h.user} on Pixabay`,
            needsCrop: false,
          },
        ];
      }
      if (!h.largeImageURL) return [];
      return [
        {
          provider: this.provider,
          providerId: String(h.id),
          kind: "image" as const,
          downloadUrl: h.largeImageURL,
          previewUrl: h.webformatURL ?? h.largeImageURL,
          pageUrl: h.pageURL,
          width: h.imageWidth ?? 0,
          height: h.imageHeight ?? 0,
          author: h.user,
          licenceUrl: LICENCE,
          attribution: `Image by ${h.user} on Pixabay`,
          needsCrop: false,
        },
      ];
    });
    return rankPortraitFirst(results);
  }
}
