import { rankPortraitFirst, type StockProvider, type StockQuery, type StockResult } from "./stock";

const LICENCE = "https://www.pexels.com/license/";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: { large2x: string; medium: string };
}
interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  duration: number;
  user: { name: string };
  image: string;
  video_files: { link: string; width: number; height: number; file_type: string }[];
}

export class PexelsStock implements StockProvider {
  readonly provider = "pexels";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(q: StockQuery): Promise<StockResult[]> {
    const base =
      q.kind === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    const url = `${base}?${new URLSearchParams({ query: q.query, orientation: q.orientation, per_page: String(q.perPage ?? 15) })}`;
    const res = await this.fetchImpl(url, { headers: { authorization: this.apiKey } });
    if (!res.ok) throw new Error(`Pexels ${res.status}`);
    const data = (await res.json()) as { photos?: PexelsPhoto[]; videos?: PexelsVideo[] };
    const results: StockResult[] =
      q.kind === "video"
        ? (data.videos ?? [])
            .filter((v) => !q.minDurationMs || v.duration * 1000 >= q.minDurationMs)
            .map((v) => {
              const file =
                v.video_files
                  .filter((f) => f.file_type === "video/mp4")
                  .sort((a, b) => b.height - a.height)[0] ?? v.video_files[0];
              return {
                provider: this.provider,
                providerId: String(v.id),
                kind: "video" as const,
                downloadUrl: file?.link ?? "",
                previewUrl: v.image,
                pageUrl: v.url,
                width: v.width,
                height: v.height,
                durationMs: v.duration * 1000,
                author: v.user.name,
                licenceUrl: LICENCE,
                attribution: `Video by ${v.user.name} on Pexels`,
                needsCrop: false,
              };
            })
        : (data.photos ?? []).map((p) => ({
            provider: this.provider,
            providerId: String(p.id),
            kind: "image" as const,
            downloadUrl: p.src.large2x,
            previewUrl: p.src.medium,
            pageUrl: p.url,
            width: p.width,
            height: p.height,
            author: p.photographer,
            licenceUrl: LICENCE,
            attribution: `Photo by ${p.photographer} on Pexels`,
            needsCrop: false,
          }));
    return rankPortraitFirst(results.filter((r) => r.downloadUrl));
  }
}
