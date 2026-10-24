import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  type OwnVideo,
  QuotaExceeded,
  ReconnectRequired,
  type UploadInput,
  type YouTubeChannel,
  type YouTubeClient,
} from "./youtube";

/**
 * Offline YouTube for tests and SHORTLOOP_FAKE_PROVIDERS. The "consent screen" redirects straight back to the
 * callback with code `fake-<state>`. Refresh tokens containing "revoked" fail like an expired grant.
 */
export class FakeYouTube implements YouTubeClient {
  readonly uploads: { videoId: string; metadata: UploadInput["metadata"]; bytes: number }[] = [];
  readonly revoked: string[] = [];
  /** Uploads allowed before QuotaExceeded (simulates the daily quota). */
  quotaLeft = Number.POSITIVE_INFINITY;

  /** The connected channel's own uploads, newest first (12 history explainers by default). */
  videos: OwnVideo[] = FAKE_OWN_VIDEOS;

  /** `channel`: always return this channel; otherwise each consent yields its own "Fake Channel". */
  constructor(
    private readonly callbackUrl = "/api/channels/youtube/callback",
    private readonly channel?: YouTubeChannel,
  ) {}

  authUrl(state: string): string {
    return `${this.callbackUrl}?code=fake-code-${randomUUID().slice(0, 8)}&state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string) {
    if (!code.startsWith("fake")) throw new Error("bad code");
    return {
      refreshToken: `refresh-${randomUUID()}`,
      accessToken: `access-${code.replace(/^fake-code-?/, "") || "fake"}`,
      scopes: ["youtube.upload", "youtube.readonly", "yt-analytics.readonly"],
    };
  }
  async accessToken(refreshToken: string) {
    if (refreshToken.includes("revoked")) throw new ReconnectRequired();
    return "access-fake";
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
  async myChannel(accessToken: string) {
    return this.channel ?? { id: `UC_fake_${accessToken.replace(/^access-/, "")}`, title: "Fake Channel" };
  }
  async myVideos(_accessToken: string, max = 50) {
    return this.videos.slice(0, Math.min(50, max));
  }
  async upload(input: UploadInput) {
    if (this.quotaLeft <= 0) throw new QuotaExceeded("YouTube quota: uploadLimitExceeded");
    this.quotaLeft -= 1;
    await input.onSession?.(`https://fake.upload/${randomUUID()}`);
    const videoId = `fakevid${this.uploads.length + 1}`;
    this.uploads.push({ videoId, metadata: input.metadata, bytes: (await stat(input.filePath)).size });
    return { videoId };
  }
}

const FAKE_TITLES = [
  "Why the Roman legion almost never retreated",
  "Why the Vikings sailed without a compass",
  "3 ancient empires that vanished overnight",
  "The medieval castle trick nobody talks about",
  "Why the pyramids were built by paid workers",
  "3 Roman inventions we still use every day",
  "How the ancient Greeks measured the Earth",
  "The empire that ran on salt",
  "Why the Spartans feared the sea",
  "3 lost cities archaeologists finally found",
  "How a legion built a road in a week",
  "Why the Byzantine empire lasted a thousand years",
];

/** Twelve public uploads from an imaginary history channel, for tests and fake mode. */
export const FAKE_OWN_VIDEOS: OwnVideo[] = FAKE_TITLES.map((title, i) => ({
  id: `fakeown${i + 1}`,
  title,
  description: `${title}. Ancient history, told fast. The empire, the legion and the people behind them. Sources in the pinned comment.`,
  publishedAt: new Date(Date.UTC(2026, 8, 30 - i)).toISOString(),
  privacyStatus: "public",
}));
