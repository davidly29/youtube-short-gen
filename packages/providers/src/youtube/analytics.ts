import { createHash } from "node:crypto";
import { QuotaExceeded, ReconnectRequired } from "./youtube";

/** Read-only access to the channel's own YouTube Analytics (E10-01). */
export const YOUTUBE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

/** Whether a stored grant (space-separated scopes, full URLs or short names) includes analytics. */
export const hasAnalyticsScope = (scopes: string | null | undefined): boolean =>
  (scopes ?? "").split(/\s+/).some((s) => s === YOUTUBE_ANALYTICS_SCOPE || s === "yt-analytics.readonly");

/** One video's numbers for one day, as YouTube Analytics reports them. */
export interface VideoDayMetrics {
  videoId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  views: number;
  /** Average percentage viewed; above 100 when Shorts loop. */
  avgViewPct: number;
  likes: number;
  comments: number;
  subsGained: number;
}

export interface VideoMetricsQuery {
  accessToken: string;
  videoId: string;
  /** Inclusive, `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive, `YYYY-MM-DD`. */
  endDate: string;
}

/** The grant predates the analytics scope: the creator must reconnect the channel to share stats. */
export class AnalyticsScopeMissing extends Error {
  constructor(message = "Reconnect this channel to let ShortLoop read its YouTube stats.") {
    super(message);
  }
}

export interface YouTubeAnalyticsClient {
  /** Daily metrics for one of the authorised channel's own videos. Days without data are omitted. */
  videoDaily(query: VideoMetricsQuery): Promise<VideoDayMetrics[]>;
}

const REPORTS = "https://youtubeanalytics.googleapis.com/v2/reports";
const METRICS = ["views", "averageViewPercentage", "likes", "comments", "subscribersGained"] as const;

interface ReportBody {
  columnHeaders?: { name: string }[];
  rows?: (string | number)[][];
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

/** YouTube Analytics API v2 `reports.query` over plain HTTP (injectable fetch for cassette tests). */
export class HttpYouTubeAnalytics implements YouTubeAnalyticsClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async videoDaily(q: VideoMetricsQuery): Promise<VideoDayMetrics[]> {
    const params = new URLSearchParams({
      ids: "channel==MINE",
      startDate: q.startDate,
      endDate: q.endDate,
      metrics: METRICS.join(","),
      dimensions: "day",
      filters: `video==${q.videoId}`,
      sort: "day",
    });
    const res = await this.fetchImpl(`${REPORTS}?${params}`, {
      headers: { authorization: `Bearer ${q.accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as ReportBody;
    if (!res.ok) {
      const reason = body.error?.errors?.[0]?.reason;
      if (res.status === 401) throw new ReconnectRequired();
      if (res.status === 403 && (reason === "insufficientPermissions" || reason === "forbidden"))
        throw new AnalyticsScopeMissing();
      if (reason === "quotaExceeded" || reason === "rateLimitExceeded")
        throw new QuotaExceeded(`YouTube Analytics quota: ${reason}`);
      const msg = body.error?.message;
      throw new Error(
        `YouTube Analytics failed (${res.status})${msg ? `: ${String(msg).slice(0, 200)}` : ""}`,
      );
    }
    const cols = (body.columnHeaders ?? []).map((c) => c.name);
    const at = (row: (string | number)[], name: string) => row[cols.indexOf(name)];
    const num = (v: string | number | undefined) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
    return (body.rows ?? []).flatMap((row) => {
      const date = at(row, "day");
      if (typeof date !== "string") return [];
      return [
        {
          videoId: q.videoId,
          date,
          views: Math.max(0, Math.round(num(at(row, "views")))),
          avgViewPct: Math.max(0, num(at(row, "averageViewPercentage"))),
          likes: Math.max(0, Math.round(num(at(row, "likes")))),
          comments: Math.max(0, Math.round(num(at(row, "comments")))),
          subsGained: Math.round(num(at(row, "subscribersGained"))),
        },
      ];
    });
  }
}

const DAY_MS = 86_400_000;

/** Every `YYYY-MM-DD` from start to end inclusive (UTC). */
export function daysBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (let t = Date.parse(`${startDate}T00:00:00Z`); t <= end; t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * Offline analytics for tests and SHORTLOOP_FAKE_PROVIDERS: deterministic numbers per (video, day), so
 * re-ingesting gives the same rows. `noScope` simulates a grant made before the analytics scope.
 */
export class FakeYouTubeAnalytics implements YouTubeAnalyticsClient {
  readonly calls: VideoMetricsQuery[] = [];
  noScope = false;
  /** Override the numbers for a video (e.g. to test ranking). */
  readonly overrides = new Map<string, Partial<Omit<VideoDayMetrics, "videoId" | "date">>>();

  async videoDaily(q: VideoMetricsQuery): Promise<VideoDayMetrics[]> {
    this.calls.push(q);
    if (this.noScope) throw new AnalyticsScopeMissing();
    return daysBetween(q.startDate, q.endDate).map((date) => {
      const h = createHash("sha256").update(`${q.videoId}:${date}`).digest();
      return {
        videoId: q.videoId,
        date,
        views: 100 + (h.readUInt16BE(0) % 4900),
        avgViewPct: 40 + (h.readUInt16BE(2) % 700) / 10,
        likes: h.readUInt16BE(4) % 200,
        comments: h.readUInt16BE(6) % 30,
        subsGained: h.readUInt16BE(8) % 12,
        ...this.overrides.get(q.videoId),
      };
    });
  }
}
