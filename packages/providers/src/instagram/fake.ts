import { randomUUID } from "node:crypto";
import {
  InstagramRateLimited,
  type ContainerStatus,
  type InstagramAccount,
  type InstagramClient,
  type ReelInput,
} from "./instagram";

/**
 * Offline Instagram for tests and SHORTLOOP_FAKE_PROVIDERS. Containers finish after `pollsUntilFinished` status
 * checks; `account` and `limit` are settable to simulate personal accounts and used-up publishing limits.
 */
export class FakeInstagram implements InstagramClient {
  account: InstagramAccount = {
    userId: "17840000000000001",
    username: "fake.reels",
    accountType: "MEDIA_CREATOR",
  };
  limit = { used: 0, total: 100, windowS: 86_400 };
  /** Status checks before a container reports FINISHED (0 = immediately). */
  pollsUntilFinished = 1;
  /** Make the next N API calls fail with a rate limit. */
  rateLimitNext = 0;
  /** Force a terminal container status instead of FINISHED. */
  failWith?: Extract<ContainerStatus, "ERROR" | "EXPIRED">;
  readonly containers = new Map<string, { input: ReelInput; polls: number }>();
  readonly published: { mediaId: string; containerId: string; caption: string; videoUrl: string }[] = [];
  statusChecks = 0;

  constructor(private readonly callbackUrl = "/publish/instagram/callback") {}

  private gate() {
    if (this.rateLimitNext > 0) {
      this.rateLimitNext -= 1;
      throw new InstagramRateLimited("Instagram's rate limit was hit.");
    }
  }
  authUrl(state: string) {
    return `${this.callbackUrl}?code=fake-code-${randomUUID().slice(0, 8)}&state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string) {
    if (!code.startsWith("fake")) throw new Error("bad code");
    return {
      accessToken: `ig-${randomUUID().slice(0, 8)}`,
      userId: this.account.userId,
      expiresInS: 5_184_000,
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    };
  }
  async refresh(accessToken: string) {
    return {
      accessToken: `${accessToken}-r`,
      userId: this.account.userId,
      expiresInS: 5_184_000,
      scopes: [],
    };
  }
  async me() {
    return { ...this.account };
  }
  async publishingLimit() {
    this.gate();
    return { ...this.limit };
  }
  async createReelContainer(input: ReelInput) {
    this.gate();
    const containerId = `cont_${this.containers.size + 1}`;
    this.containers.set(containerId, { input, polls: 0 });
    return { containerId };
  }
  async containerStatus(_t: string, containerId: string): Promise<ContainerStatus> {
    this.statusChecks += 1;
    const c = this.containers.get(containerId);
    if (!c) return "ERROR";
    c.polls += 1;
    if (this.failWith) return this.failWith;
    return c.polls >= this.pollsUntilFinished ? "FINISHED" : "IN_PROGRESS";
  }
  async publishContainer(_t: string, _u: string, containerId: string) {
    this.gate();
    const c = this.containers.get(containerId);
    if (!c) throw new Error("unknown container");
    const mediaId = `1790000000000000${this.published.length + 1}`;
    this.limit.used += 1;
    this.published.push({ mediaId, containerId, caption: c.input.caption, videoUrl: c.input.videoUrl });
    return { mediaId };
  }
  async permalink(_t: string, mediaId: string) {
    return `https://www.instagram.com/reel/FAKE${mediaId.slice(-4)}/`;
  }
}
