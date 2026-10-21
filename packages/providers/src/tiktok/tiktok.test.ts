import { describe, expect, it } from "vitest";
import { cassette } from "../testing/cassette";
import {
  allowedPrivacy,
  commercialLabel,
  declarationParts,
  FAKE_CREATOR,
  FakeTikTok,
  HttpTikTok,
  TIKTOK_SCOPES,
  TikTokCannotPost,
  TikTokRateLimited,
  TikTokReconnectRequired,
  tiktokAudited,
  tiktokFromEnv,
  tiktokPostProblems,
  toDirectPost,
  type TikTokPostContext,
  type TikTokPostForm,
} from ".";

const config = {
  clientKey: "ck_test",
  clientSecret: "cs_test",
  redirectUri: "https://app.test/publish/tiktok/callback",
};
const API = "https://open.tiktokapis.com/v2";
const ok = { code: "ok", message: "", log_id: "l1" };

describe("TikTok Login Kit (E8-03)", () => {
  it("asks only for basic profile + video.publish and carries the state", () => {
    const u = new URL(new HttpTikTok(config).authUrl("state-1"));
    expect(u.origin + u.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("scope")?.split(",")).toEqual([...TIKTOK_SCOPES]);
    expect(u.searchParams.get("client_key")).toBe("ck_test");
    expect(u.searchParams.get("state")).toBe("state-1");
    expect(u.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("exchanges the code and refuses a grant without video.publish", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: `${API}/oauth/token/` },
        response: {
          status: 200,
          body: {
            access_token: "at",
            refresh_token: "rt",
            open_id: "oid",
            scope: "user.info.basic,video.publish",
          },
        },
      },
      {
        request: { method: "POST", url: `${API}/oauth/token/` },
        response: {
          status: 200,
          body: { access_token: "at", refresh_token: "rt", open_id: "oid", scope: "user.info.basic" },
        },
      },
    ]);
    const tt = new HttpTikTok(config, c.fetch);
    await expect(tt.exchangeCode("code1")).resolves.toEqual({
      accessToken: "at",
      refreshToken: "rt",
      openId: "oid",
      scopes: ["user.info.basic", "video.publish"],
    });
    const body = new URLSearchParams(c.calls[0]?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_key")).toBe("ck_test");
    await expect(tt.exchangeCode("code2")).rejects.toThrow(/Posting permission/);
    c.assertDone();
  });

  it("an expired refresh token asks the user to reconnect", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: `${API}/oauth/token/` },
        response: {
          status: 400,
          body: { error: "invalid_grant", error_description: "Refresh token is invalid" },
        },
      },
    ]);
    await expect(new HttpTikTok(config, c.fetch).refresh("rt")).rejects.toBeInstanceOf(
      TikTokReconnectRequired,
    );
  });

  it("reads creator_info before the form, with Bearer auth", async () => {
    const c = cassette([
      {
        request: {
          method: "POST",
          url: `${API}/post/publish/creator_info/query/`,
          headers: { authorization: "Bearer at" },
        },
        response: {
          status: 200,
          body: {
            data: {
              creator_avatar_url: "https://p16.tiktokcdn.com/a.jpg",
              creator_username: "octofacts",
              creator_nickname: "Octo Facts",
              privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY", "SOMETHING_NEW"],
              comment_disabled: false,
              duet_disabled: true,
              stitch_disabled: false,
              max_video_post_duration_sec: 300,
            },
            error: ok,
          },
        },
      },
    ]);
    const info = await new HttpTikTok(config, c.fetch).creatorInfo("at");
    expect(info).toEqual({
      avatarUrl: "https://p16.tiktokcdn.com/a.jpg",
      username: "octofacts",
      nickname: "Octo Facts",
      privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
      maxVideoPostDurationSec: 300,
    });
  });

  it("maps 'can't post now', rate limits and bad tokens to typed errors", async () => {
    const err = (code: string, status = 403) => ({
      request: { method: "POST", url: `${API}/post/publish/creator_info/query/` },
      response: { status, body: { data: {}, error: { code, message: code, log_id: "x" } } },
    });
    const c = cassette([
      err("spam_risk_too_many_posts"),
      err("rate_limit_exceeded", 429),
      err("access_token_invalid", 401),
    ]);
    const tt = new HttpTikTok(config, c.fetch);
    await expect(tt.creatorInfo("at")).rejects.toBeInstanceOf(TikTokCannotPost);
    await expect(tt.creatorInfo("at")).rejects.toBeInstanceOf(TikTokRateLimited);
    await expect(tt.creatorInfo("at")).rejects.toBeInstanceOf(TikTokReconnectRequired);
  });

  it("Direct Post pulls the exact file from our signed URL and sends every post_info field", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: `${API}/post/publish/video/init/` },
        response: { status: 200, body: { data: { publish_id: "v_pub_1" }, error: ok } },
      },
      {
        request: { method: "POST", url: `${API}/post/publish/status/fetch/` },
        response: {
          status: 200,
          body: {
            data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7300000001] },
            error: ok,
          },
        },
      },
    ]);
    const tt = new HttpTikTok(config, c.fetch);
    const signed = "https://media.shortloop.test/renders/r1.mp4?X-Amz-Signature=abc";
    await expect(
      tt.directPost({
        accessToken: "at",
        videoUrl: signed,
        title: "Octopus hearts #facts",
        privacyLevel: "SELF_ONLY",
        disableComment: false,
        disableDuet: true,
        disableStitch: true,
        brandContentToggle: false,
        brandOrganicToggle: false,
        isAigc: true,
      }),
    ).resolves.toEqual({ publishId: "v_pub_1" });
    expect(JSON.parse(c.calls[0]?.body as string)).toEqual({
      post_info: {
        title: "Octopus hearts #facts",
        privacy_level: "SELF_ONLY",
        disable_comment: false,
        disable_duet: true,
        disable_stitch: true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: true,
      },
      source_info: { source: "PULL_FROM_URL", video_url: signed },
    });
    await expect(tt.postStatus("at", "v_pub_1")).resolves.toEqual({
      status: "PUBLISH_COMPLETE",
      failReason: undefined,
      postIds: ["7300000001"],
    });
    expect(JSON.parse(c.calls[1]?.body as string)).toEqual({ publish_id: "v_pub_1" });
    c.assertDone();
  });

  it("is configured from env, and unaudited by default", () => {
    expect(tiktokFromEnv({})).toBeUndefined();
    const tt = tiktokFromEnv({
      TIKTOK_CLIENT_KEY: "k",
      TIKTOK_CLIENT_SECRET: "s",
      APP_URL: "https://a.test",
    });
    expect(new URL(tt?.authUrl("s") ?? "").searchParams.get("redirect_uri")).toBe(
      "https://a.test/publish/tiktok/callback",
    );
    expect(tiktokAudited({})).toBe(false);
    expect(tiktokAudited({ TIKTOK_AUDITED: "1" })).toBe(true);
  });
});

describe("TikTok post form rules (content-sharing guidelines)", () => {
  const ctx: TikTokPostContext = {
    creator: FAKE_CREATOR,
    audited: true,
    videoDurationSec: 45,
    aiRequired: false,
  };
  const form: TikTokPostForm = {
    title: "Octopus hearts",
    privacyLevel: "PUBLIC_TO_EVERYONE",
    allowComment: true,
    allowDuet: false,
    allowStitch: false,
    commercial: false,
    yourBrand: false,
    brandedContent: false,
    aiGenerated: false,
    consent: true,
  };

  it("a complete form has no problems", () => {
    expect(tiktokPostProblems(form, ctx)).toEqual([]);
  });

  it("privacy has no default and must come from creator_info", () => {
    expect(tiktokPostProblems({ ...form, privacyLevel: undefined }, ctx)).toContain(
      "Choose who can view this video.",
    );
    expect(tiktokPostProblems({ ...form, privacyLevel: "FOLLOWER_OF_CREATOR" }, ctx)).toEqual([
      "That visibility isn't available for your TikTok account.",
    ]);
  });

  it("while unaudited, only Only me is offered or accepted", () => {
    const un = { ...ctx, audited: false };
    expect(allowedPrivacy(un)).toEqual(["SELF_ONLY"]);
    expect(allowedPrivacy(ctx)).toEqual(FAKE_CREATOR.privacyLevelOptions);
    expect(tiktokPostProblems(form, un)).toEqual([
      "Until TikTok approves ShortLoop, posts can only be private (Only me).",
    ]);
    expect(tiktokPostProblems({ ...form, privacyLevel: "SELF_ONLY" }, un)).toEqual([]);
  });

  it("interactions the creator turned off can't be switched on", () => {
    expect(tiktokPostProblems({ ...form, allowStitch: true }, ctx)).toEqual([
      "Stitches are turned off for your account.",
    ]);
  });

  it("commercial disclosure needs a choice, labels the post, and branded content can't be private", () => {
    expect(tiktokPostProblems({ ...form, commercial: true }, ctx)).toEqual([
      "You need to indicate if your content promotes yourself, a third party, or both.",
    ]);
    expect(commercialLabel({ commercial: true, yourBrand: true, brandedContent: false })).toBe(
      "Promotional content",
    );
    expect(commercialLabel({ commercial: true, yourBrand: true, brandedContent: true })).toBe(
      "Paid partnership",
    );
    expect(commercialLabel({ commercial: false, yourBrand: true, brandedContent: true })).toBeUndefined();
    expect(
      tiktokPostProblems({ ...form, commercial: true, brandedContent: true, privacyLevel: "SELF_ONLY" }, ctx),
    ).toEqual(["Branded content visibility can't be set to private."]);
    expect(declarationParts({ commercial: true, brandedContent: true })).toEqual([
      "branded_content_policy",
      "music_usage",
    ]);
    expect(declarationParts({ commercial: true, brandedContent: false })).toEqual(["music_usage"]);
  });

  it("checks duration, consent and the required AI label", () => {
    expect(tiktokPostProblems(form, { ...ctx, videoDurationSec: 700 })[0]).toMatch(/up to 600s/);
    expect(tiktokPostProblems({ ...form, consent: false }, ctx)).toEqual([
      "Confirm the declaration to post.",
    ]);
    expect(tiktokPostProblems(form, { ...ctx, aiRequired: true })).toEqual([
      "This Short must carry TikTok's AI-generated label.",
    ]);
  });

  it("builds the API body only from a valid form, inverting the interaction switches", () => {
    expect(() => toDirectPost({ ...form, consent: false }, ctx, "at", "https://v")).toThrow(/declaration/);
    expect(
      toDirectPost({ ...form, commercial: true, yourBrand: true, aiGenerated: true }, ctx, "at", "https://v"),
    ).toEqual({
      accessToken: "at",
      videoUrl: "https://v",
      title: "Octopus hearts",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disableComment: false,
      disableDuet: true,
      disableStitch: true,
      brandContentToggle: false,
      brandOrganicToggle: true,
      isAigc: true,
    });
  });
});

describe("FakeTikTok", () => {
  it("round-trips connect -> post -> status; private posts have no public id", async () => {
    const tt = new FakeTikTok();
    const url = new URL(tt.authUrl("st"), "https://x.test");
    expect(url.pathname).toBe("/publish/tiktok/callback");
    const g = await tt.exchangeCode(url.searchParams.get("code") ?? "");
    const again = await tt.refresh(g.refreshToken);
    expect(again.openId).toBe(g.openId);
    await expect(tt.refresh("tt-refresh-revoked-1")).rejects.toBeInstanceOf(TikTokReconnectRequired);
    const { publishId } = await tt.directPost({
      ...toDirectPost(
        {
          title: "t",
          privacyLevel: "SELF_ONLY",
          allowComment: false,
          allowDuet: false,
          allowStitch: false,
          commercial: false,
          yourBrand: false,
          brandedContent: false,
          aiGenerated: false,
          consent: true,
        },
        { creator: FAKE_CREATOR, audited: false, videoDurationSec: 30, aiRequired: false },
        g.accessToken,
        "https://v",
      ),
    });
    await expect(tt.postStatus(g.accessToken, publishId)).resolves.toEqual({
      status: "PUBLISH_COMPLETE",
      postIds: [],
    });
  });
});
