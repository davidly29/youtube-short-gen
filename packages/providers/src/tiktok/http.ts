import {
  TIKTOK_PRIVACY,
  TIKTOK_SCOPES,
  TikTokCannotPost,
  TikTokRateLimited,
  TikTokReconnectRequired,
  type CreatorInfo,
  type DirectPostInput,
  type PostStatus,
  type TikTokClient,
  type TikTokGrant,
  type TikTokOAuthConfig,
  type TikTokPrivacy,
  type TikTokUser,
} from "./tiktok";

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";

interface ApiError {
  code?: string;
  message?: string;
  log_id?: string;
}

/** Errors that mean "this creator can't post right now", with the message we show. */
const CANNOT_POST: Record<string, string> = {
  spam_risk_too_many_posts: "TikTok's daily post limit for your account is reached. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok isn't letting this account post right now.",
  reached_active_user_cap: "ShortLoop has reached TikTok's daily limit of posting accounts. Try again later.",
  unaudited_client_can_only_post_to_private_accounts:
    "Until TikTok approves ShortLoop, your TikTok account must be set to private to post.",
  privacy_level_option_mismatch: "That visibility isn't available for your TikTok account any more.",
  url_ownership_unverified: "TikTok couldn't verify the video's download domain (operator setup, see docs).",
};

async function fail(res: Response, what: string, err?: ApiError): Promise<never> {
  const body = err
    ? { error: err }
    : ((await res.json().catch(() => ({}))) as { error?: ApiError | string; error_description?: string });
  const e = typeof body.error === "object" ? body.error : undefined;
  const code = e?.code ?? (typeof body.error === "string" ? body.error : undefined);
  if (code === "invalid_grant" || code === "access_token_invalid" || code === "scope_not_authorized")
    throw new TikTokReconnectRequired();
  if (res.status === 401) throw new TikTokReconnectRequired();
  if (code === "rate_limit_exceeded" || res.status === 429)
    throw new TikTokRateLimited("TikTok is busy right now. Try again in a minute.");
  if (code && CANNOT_POST[code]) throw new TikTokCannotPost(CANNOT_POST[code]);
  const message =
    e?.message ?? ("error_description" in body ? body.error_description : undefined) ?? code ?? "";
  throw new Error(
    `TikTok ${what} failed (${res.status})${message ? `: ${String(message).slice(0, 200)}` : ""}`,
  );
}

/** TikTok's v2 API over plain HTTP (injectable fetch for cassette tests). */
export class HttpTikTok implements TikTokClient {
  constructor(
    private readonly config: TikTokOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authUrl(state: string): string {
    const u = new URL(AUTH);
    u.search = new URLSearchParams({
      client_key: this.config.clientKey,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: TIKTOK_SCOPES.join(","),
      state,
    }).toString();
    return u.toString();
  }

  private async token(params: Record<string, string>, what: string): Promise<TikTokGrant> {
    const res = await this.fetchImpl(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    });
    const t = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || t.error || !t.access_token || !t.refresh_token || !t.open_id)
      await fail(new Response(JSON.stringify(t), { status: res.ok ? 400 : res.status }), what);
    return {
      accessToken: t.access_token as string,
      refreshToken: t.refresh_token as string,
      openId: t.open_id as string,
      scopes: (t.scope ?? "").split(/[ ,]/).filter(Boolean),
    };
  }

  async exchangeCode(code: string) {
    const g = await this.token(
      { grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri },
      "sign-in",
    );
    if (!g.scopes.includes("video.publish"))
      throw new Error(
        'Posting permission wasn\'t granted. Connect again and allow "Post content to TikTok".',
      );
    return g;
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, "token refresh");
  }

  async revoke(accessToken: string): Promise<void> {
    await this.fetchImpl(`${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token: accessToken,
      }),
    }); // best effort: an invalid token is as good as revoked
  }

  /** TikTok answers `{ data, error: { code: "ok" } }` on success. */
  private async call<T>(path: string, accessToken: string, what: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json; charset=UTF-8" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: ApiError };
    if (!res.ok || (json.error?.code && json.error.code !== "ok")) await fail(res, what, json.error);
    return (json.data ?? {}) as T;
  }

  async userInfo(accessToken: string): Promise<TikTokUser> {
    const d = await this.call<{ user?: { open_id: string; display_name?: string; avatar_url?: string } }>(
      "/user/info/?fields=open_id,display_name,avatar_url",
      accessToken,
      "profile lookup",
    );
    if (!d.user) throw new Error("TikTok didn't return your profile. Please try connecting again.");
    return {
      openId: d.user.open_id,
      displayName: d.user.display_name || "TikTok account",
      avatarUrl: d.user.avatar_url || undefined,
    };
  }

  async creatorInfo(accessToken: string): Promise<CreatorInfo> {
    const d = await this.call<{
      creator_avatar_url?: string;
      creator_username?: string;
      creator_nickname?: string;
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
      max_video_post_duration_sec?: number;
    }>("/post/publish/creator_info/query/", accessToken, "creator lookup", {});
    return {
      avatarUrl: d.creator_avatar_url || undefined,
      username: d.creator_username ?? "",
      nickname: d.creator_nickname || d.creator_username || "TikTok account",
      privacyLevelOptions: (d.privacy_level_options ?? []).filter((p): p is TikTokPrivacy =>
        (TIKTOK_PRIVACY as readonly string[]).includes(p),
      ),
      commentDisabled: Boolean(d.comment_disabled),
      duetDisabled: Boolean(d.duet_disabled),
      stitchDisabled: Boolean(d.stitch_disabled),
      maxVideoPostDurationSec: d.max_video_post_duration_sec ?? 60,
    };
  }

  async directPost(input: DirectPostInput): Promise<{ publishId: string }> {
    const d = await this.call<{ publish_id?: string }>(
      "/post/publish/video/init/",
      input.accessToken,
      "post",
      {
        post_info: {
          title: input.title,
          privacy_level: input.privacyLevel,
          disable_comment: input.disableComment,
          disable_duet: input.disableDuet,
          disable_stitch: input.disableStitch,
          brand_content_toggle: input.brandContentToggle,
          brand_organic_toggle: input.brandOrganicToggle,
          is_aigc: input.isAigc,
        },
        source_info: { source: "PULL_FROM_URL", video_url: input.videoUrl },
      },
    );
    if (!d.publish_id) throw new Error("TikTok didn't return a publish id.");
    return { publishId: d.publish_id };
  }

  async postStatus(accessToken: string, publishId: string): Promise<PostStatus> {
    const d = await this.call<{
      status?: PostStatus["status"];
      fail_reason?: string;
      publicaly_available_post_id?: (string | number)[];
    }>("/post/publish/status/fetch/", accessToken, "status check", { publish_id: publishId });
    return {
      status: d.status ?? "PROCESSING_DOWNLOAD",
      failReason: d.fail_reason || undefined,
      postIds: (d.publicaly_available_post_id ?? []).map(String),
    };
  }
}
