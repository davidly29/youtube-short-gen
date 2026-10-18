import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
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
      scopes: ["youtube.upload", "youtube.readonly"],
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
  async upload(input: UploadInput) {
    if (this.quotaLeft <= 0) throw new QuotaExceeded("YouTube quota: uploadLimitExceeded");
    this.quotaLeft -= 1;
    await input.onSession?.(`https://fake.upload/${randomUUID()}`);
    const videoId = `fakevid${this.uploads.length + 1}`;
    this.uploads.push({ videoId, metadata: input.metadata, bytes: (await stat(input.filePath)).size });
    return { videoId };
  }
}
