import { describe, expect, it } from "vitest";
import { cassette } from "../testing/cassette";
import {
  assertProfessional,
  FakeInstagram,
  INSTAGRAM_GRAPH,
  HttpInstagram,
  INSTAGRAM_SCOPES,
  instagramFromEnv,
  InstagramRateLimited,
  InstagramReconnectRequired,
  ProfessionalAccountRequired,
  publishReel,
  SWITCH_TO_PROFESSIONAL,
} from ".";

const config = {
  clientId: "1234",
  clientSecret: "ig_secret",
  redirectUri: "https://app.test/publish/instagram/callback",
};
const reel = {
  accessToken: "IGAA",
  userId: "1784",
  videoUrl: "https://media.shortloop.test/renders/r1.mp4?sig=abc",
  caption: "Why octopuses have three hearts #shorts",
};
const noSleep = async () => undefined;
const at = () => new Date("2026-10-21T10:00:00Z");

describe("Instagram Login (E8-04)", () => {
  it("asks for basic + content_publish and carries the state", () => {
    const u = new URL(new HttpInstagram(config).authUrl("st"));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("scope")?.split(",")).toEqual([...INSTAGRAM_SCOPES]);
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("swaps the code for a long-lived token", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: "https://api.instagram.com/oauth/access_token" },
        response: {
          status: 200,
          body: {
            data: [
              {
                access_token: "short",
                user_id: 1784,
                permissions: "instagram_business_basic,instagram_business_content_publish",
              },
            ],
          },
        },
      },
      {
        request: {
          method: "GET",
          url: "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=ig_secret&access_token=short",
        },
        response: { status: 200, body: { access_token: "long", token_type: "bearer", expires_in: 5183944 } },
      },
    ]);
    await expect(new HttpInstagram(config, c.fetch).exchangeCode("code")).resolves.toEqual({
      accessToken: "long",
      userId: "1784",
      expiresInS: 5183944,
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    });
    c.assertDone();
  });

  it("personal accounts get a clear 'switch to Professional' message", async () => {
    const c = cassette([
      {
        request: {
          method: "GET",
          url: `${INSTAGRAM_GRAPH}/me?fields=user_id,username,account_type,profile_picture_url`,
        },
        response: { status: 200, body: { user_id: "1784", username: "me", account_type: "PERSONAL" } },
      },
      {
        request: {
          method: "GET",
          url: `${INSTAGRAM_GRAPH}/me?fields=user_id,username,account_type,profile_picture_url`,
        },
        response: { status: 200, body: { user_id: "1785", username: "pro", account_type: "MEDIA_CREATOR" } },
      },
    ]);
    const ig = new HttpInstagram(config, c.fetch);
    const personal = await ig.me("t");
    expect(() => assertProfessional(personal)).toThrow(ProfessionalAccountRequired);
    expect(() => assertProfessional(personal)).toThrow(/switch to professional account/i);
    expect(SWITCH_TO_PROFESSIONAL).toMatch(/Professional accounts/);
    expect(assertProfessional(await ig.me("t")).username).toBe("pro");
  });

  it("maps expired tokens and rate limits to typed errors", async () => {
    const url = `${INSTAGRAM_GRAPH}/1784/content_publishing_limit?fields=config,quota_usage`;
    const c = cassette([
      {
        request: { method: "GET", url },
        response: { status: 400, body: { error: { message: "expired", type: "OAuthException", code: 190 } } },
      },
      {
        request: { method: "GET", url },
        response: { status: 400, body: { error: { message: "limit", code: 4 } } },
      },
      {
        request: { method: "GET", url },
        response: { status: 400, body: { error: { message: "cap", code: 9, error_subcode: 2207042 } } },
      },
    ]);
    const ig = new HttpInstagram(config, c.fetch);
    await expect(ig.publishingLimit("t", "1784")).rejects.toBeInstanceOf(InstagramReconnectRequired);
    await expect(ig.publishingLimit("t", "1784")).rejects.toBeInstanceOf(InstagramRateLimited);
    await expect(ig.publishingLimit("t", "1784")).rejects.toThrow(/24-hour publishing limit/);
  });

  it("is configured from env", () => {
    expect(instagramFromEnv({})).toBeUndefined();
    const ig = instagramFromEnv({
      INSTAGRAM_APP_ID: "1",
      INSTAGRAM_APP_SECRET: "s",
      APP_URL: "https://a.test",
    });
    expect(new URL(ig?.authUrl("s") ?? "").searchParams.get("redirect_uri")).toBe(
      "https://a.test/publish/instagram/callback",
    );
  });
});

describe("Reels publishing flow (E8-04)", () => {
  it("checks the limit, creates a REELS container, polls once a minute, publishes (HTTP cassette)", async () => {
    const c = cassette([
      {
        request: {
          method: "GET",
          url: `${INSTAGRAM_GRAPH}/1784/content_publishing_limit?fields=config,quota_usage`,
        },
        response: {
          status: 200,
          body: { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] },
        },
      },
      {
        request: {
          method: "POST",
          url: `${INSTAGRAM_GRAPH}/1784/media`,
          headers: { authorization: "Bearer IGAA" },
        },
        response: { status: 200, body: { id: "cont9" } },
      },
      {
        request: { method: "GET", url: `${INSTAGRAM_GRAPH}/cont9?fields=status_code` },
        response: { status: 200, body: { status_code: "IN_PROGRESS" } },
      },
      {
        request: { method: "GET", url: `${INSTAGRAM_GRAPH}/cont9?fields=status_code` },
        response: { status: 200, body: { status_code: "FINISHED" } },
      },
      {
        request: { method: "POST", url: `${INSTAGRAM_GRAPH}/1784/media_publish` },
        response: { status: 200, body: { id: "179001" } },
      },
      {
        request: { method: "GET", url: `${INSTAGRAM_GRAPH}/179001?fields=permalink` },
        response: { status: 200, body: { permalink: "https://www.instagram.com/reel/ABC/" } },
      },
    ]);
    const sleeps: number[] = [];
    const r = await publishReel(new HttpInstagram(config, c.fetch), reel, {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(r).toEqual({
      status: "published",
      mediaId: "179001",
      permalink: "https://www.instagram.com/reel/ABC/",
    });
    expect(sleeps).toEqual([60_000, 60_000]);
    const create = new URLSearchParams(c.calls[1]?.body as string);
    expect(create.get("media_type")).toBe("REELS");
    expect(create.get("video_url")).toBe(reel.videoUrl);
    expect(create.get("caption")).toBe(reel.caption);
    expect(new URLSearchParams(c.calls[4]?.body as string).get("creation_id")).toBe("cont9");
    c.assertDone();
  });

  it("gives up after 5 polls (5 minutes) without publishing", async () => {
    const ig = new FakeInstagram();
    ig.pollsUntilFinished = 99;
    await expect(publishReel(ig, reel, { sleep: noSleep })).rejects.toThrow(/after 5 minutes/);
    expect(ig.statusChecks).toBe(5);
    expect(ig.published).toHaveLength(0);
  });

  it("a container ERROR fails with a readable reason", async () => {
    const ig = new FakeInstagram();
    ig.failWith = "ERROR";
    await expect(publishReel(ig, reel, { sleep: noSleep })).rejects.toThrow(/couldn't process/);
  });

  it("a used-up publishing limit queues the post for the next window, before uploading", async () => {
    const ig = new FakeInstagram();
    ig.limit = { used: 100, total: 100, windowS: 86_400 };
    const r = await publishReel(ig, reel, { sleep: noSleep, now: at });
    expect(r).toEqual({
      status: "scheduled_next_window",
      retryAt: "2026-10-21T11:00:00.000Z",
      reason: expect.stringMatching(/100 posts per 24 hours/),
    });
    expect(ig.containers.size).toBe(0);
  });

  it("rate-limit errors at any step queue the post for the next window instead of failing", async () => {
    for (const step of [0, 1]) {
      const ig = new FakeInstagram();
      // step 0: the limit check is rate limited; step 1: the container create is.
      if (step === 0) ig.rateLimitNext = 1;
      else {
        const orig = ig.createReelContainer.bind(ig);
        ig.createReelContainer = async (i) => {
          ig.rateLimitNext = 1;
          return orig(i);
        };
      }
      const r = await publishReel(ig, reel, { sleep: noSleep, now: at, retryAfterMs: 30 * 60_000 });
      expect(r).toMatchObject({ status: "scheduled_next_window", retryAt: "2026-10-21T10:30:00.000Z" });
      expect(ig.published).toHaveLength(0);
    }
  });

  it("the fake publishes and counts against the limit", async () => {
    const ig = new FakeInstagram();
    const r = await publishReel(ig, reel, { sleep: noSleep });
    expect(r).toMatchObject({
      status: "published",
      permalink: expect.stringContaining("instagram.com/reel/"),
    });
    expect(ig.limit.used).toBe(1);
    expect(ig.published[0]?.videoUrl).toBe(reel.videoUrl);
  });
});
