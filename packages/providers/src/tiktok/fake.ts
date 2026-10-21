import { randomUUID } from "node:crypto";
import {
  TikTokReconnectRequired,
  type CreatorInfo,
  type DirectPostInput,
  type PostStatus,
  type TikTokClient,
  type TikTokGrant,
} from "./tiktok";

export const FAKE_CREATOR: CreatorInfo = {
  username: "fake.creator",
  nickname: "Fake Creator",
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: true,
  maxVideoPostDurationSec: 600,
};

/**
 * Offline TikTok for tests and SHORTLOOP_FAKE_PROVIDERS. The "consent screen" redirects straight back to the
 * callback with code `fake-code-…`. Refresh tokens containing "revoked" fail like an expired grant. Posts complete
 * on the first status check; private (SELF_ONLY) posts have no public post id, like the real API.
 */
export class FakeTikTok implements TikTokClient {
  readonly posts: (DirectPostInput & { publishId: string })[] = [];
  readonly revoked: string[] = [];
  creator: CreatorInfo = { ...FAKE_CREATOR };

  constructor(private readonly callbackUrl = "/publish/tiktok/callback") {}

  authUrl(state: string) {
    return `${this.callbackUrl}?code=fake-code-${randomUUID().slice(0, 8)}&state=${encodeURIComponent(state)}`;
  }
  private grant(openId: string): TikTokGrant {
    return {
      accessToken: `tt-access-${randomUUID().slice(0, 8)}`,
      refreshToken: `tt-refresh-${openId}-${randomUUID().slice(0, 8)}`,
      openId,
      scopes: ["user.info.basic", "video.publish"],
    };
  }
  async exchangeCode(code: string) {
    if (!code.startsWith("fake")) throw new Error("bad code");
    return this.grant(`fake_open_${code.replace(/^fake-code-?/, "") || "1"}`);
  }
  async refresh(refreshToken: string) {
    if (refreshToken.includes("revoked")) throw new TikTokReconnectRequired();
    const openId = /^tt-refresh-(.+)-[^-]+$/.exec(refreshToken)?.[1] ?? "fake_open_1";
    return this.grant(openId);
  }
  async revoke(accessToken: string) {
    this.revoked.push(accessToken);
  }
  async userInfo(accessToken: string) {
    return { openId: `fake_open_${accessToken}`, displayName: this.creator.nickname };
  }
  async creatorInfo() {
    return { ...this.creator, privacyLevelOptions: [...this.creator.privacyLevelOptions] };
  }
  async directPost(input: DirectPostInput) {
    const publishId = `v_pub_fake_${this.posts.length + 1}`;
    this.posts.push({ ...input, publishId });
    return { publishId };
  }
  async postStatus(_accessToken: string, publishId: string): Promise<PostStatus> {
    const post = this.posts.find((p) => p.publishId === publishId);
    if (!post) return { status: "FAILED", failReason: "publish_id not found", postIds: [] };
    return {
      status: "PUBLISH_COMPLETE",
      postIds: post.privacyLevel === "SELF_ONLY" ? [] : [`73${this.posts.indexOf(post) + 1}000`],
    };
  }
}
