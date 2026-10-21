import {
  INSTAGRAM_SCOPES,
  InstagramRateLimited,
  InstagramReconnectRequired,
  type ContainerStatus,
  type InstagramAccount,
  type InstagramAccountType,
  type InstagramClient,
  type InstagramGrant,
  type InstagramOAuthConfig,
  type PublishingLimit,
  type ReelInput,
} from "./instagram";

const AUTH = "https://www.instagram.com/oauth/authorize";
const SHORT_TOKEN = "https://api.instagram.com/oauth/access_token";
const GRAPH_ROOT = "https://graph.instagram.com";
export const INSTAGRAM_GRAPH = `${GRAPH_ROOT}/v23.0`;

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number } | string;
  error_message?: string;
  error_type?: string;
  code?: number;
}

/** App/user/BUC rate limits, plus "publishing limit reached" (subcode 2207042). */
const RATE_CODES = new Set([4, 17, 32, 613, 80002]);
const PUBLISH_LIMIT_SUBCODE = 2207042;

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as GraphError;
  const e = typeof body.error === "object" ? body.error : undefined;
  const code = e?.code ?? body.code;
  if (code === 190 || (e?.type === "OAuthException" && res.status === 401))
    throw new InstagramReconnectRequired();
  if ((code && RATE_CODES.has(code)) || e?.error_subcode === PUBLISH_LIMIT_SUBCODE || res.status === 429)
    throw new InstagramRateLimited(
      e?.error_subcode === PUBLISH_LIMIT_SUBCODE
        ? "Instagram's 24-hour publishing limit is reached for this account."
        : "Instagram's rate limit was hit.",
    );
  const message = e?.message ?? body.error_message ?? (typeof body.error === "string" ? body.error : "");
  throw new Error(`Instagram ${what} failed (${res.status})${message ? `: ${message.slice(0, 200)}` : ""}`);
}

const ACCOUNT_TYPES: Record<string, InstagramAccountType> = {
  BUSINESS: "BUSINESS",
  MEDIA_CREATOR: "MEDIA_CREATOR",
  CREATOR: "MEDIA_CREATOR",
};

/** Instagram API with Instagram Login over plain HTTP (injectable fetch for cassette tests). */
export class HttpInstagram implements InstagramClient {
  constructor(
    private readonly config: InstagramOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authUrl(state: string): string {
    const u = new URL(AUTH);
    u.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    }).toString();
    return u.toString();
  }

  private async getJson<T>(url: string, what: string, accessToken?: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (!res.ok) await fail(res, what);
    return (await res.json()) as T;
  }

  private async postForm<T>(url: string, params: Record<string, string>, what: string, accessToken?: string) {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: new URLSearchParams(params),
    });
    if (!res.ok) await fail(res, what);
    return (await res.json()) as T;
  }

  async exchangeCode(code: string): Promise<InstagramGrant> {
    const raw = await this.postForm<
      | { access_token: string; user_id: string | number; permissions?: string | string[] }
      | { data: { access_token: string; user_id: string | number; permissions?: string | string[] }[] }
    >(
      SHORT_TOKEN,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code,
      },
      "sign-in",
    );
    const short = "data" in raw ? raw.data[0] : raw;
    if (!short?.access_token)
      throw new Error("Instagram didn't return a token. Please try connecting again.");
    const perms = Array.isArray(short.permissions)
      ? short.permissions
      : (short.permissions ?? "").split(",").filter(Boolean);
    if (perms.length && !perms.includes("instagram_business_content_publish"))
      throw new Error('Publishing permission wasn\'t granted. Connect again and allow "Publish content".');
    const long = await this.getJson<{ access_token: string; expires_in: number }>(
      `${GRAPH_ROOT}/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: this.config.clientSecret,
        access_token: short.access_token,
      })}`,
      "token exchange",
    );
    return {
      accessToken: long.access_token,
      userId: String(short.user_id),
      expiresInS: long.expires_in,
      scopes: perms,
    };
  }

  async refresh(accessToken: string): Promise<InstagramGrant> {
    const t = await this.getJson<{ access_token: string; expires_in: number }>(
      `${GRAPH_ROOT}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken })}`,
      "token refresh",
    );
    const me = await this.me(t.access_token);
    return { accessToken: t.access_token, userId: me.userId, expiresInS: t.expires_in, scopes: [] };
  }

  async me(accessToken: string): Promise<InstagramAccount> {
    const d = await this.getJson<{
      user_id?: string | number;
      id?: string;
      username?: string;
      account_type?: string;
      profile_picture_url?: string;
    }>(
      `${INSTAGRAM_GRAPH}/me?fields=user_id,username,account_type,profile_picture_url`,
      "profile lookup",
      accessToken,
    );
    return {
      userId: String(d.user_id ?? d.id ?? ""),
      username: d.username ?? "",
      accountType: ACCOUNT_TYPES[(d.account_type ?? "").toUpperCase()] ?? "PERSONAL",
      avatarUrl: d.profile_picture_url || undefined,
    };
  }

  async publishingLimit(accessToken: string, userId: string): Promise<PublishingLimit> {
    const d = await this.getJson<{
      data?: { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }[];
    }>(
      `${INSTAGRAM_GRAPH}/${userId}/content_publishing_limit?fields=config,quota_usage`,
      "limit check",
      accessToken,
    );
    const row = d.data?.[0];
    return {
      used: row?.quota_usage ?? 0,
      total: row?.config?.quota_total ?? 100,
      windowS: row?.config?.quota_duration ?? 86_400,
    };
  }

  async createReelContainer(input: ReelInput) {
    const d = await this.postForm<{ id: string }>(
      `${INSTAGRAM_GRAPH}/${input.userId}/media`,
      {
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: String(input.shareToFeed ?? true),
      },
      "upload",
      input.accessToken,
    );
    return { containerId: d.id };
  }

  async containerStatus(accessToken: string, containerId: string): Promise<ContainerStatus> {
    const d = await this.getJson<{ status_code?: ContainerStatus }>(
      `${INSTAGRAM_GRAPH}/${containerId}?fields=status_code`,
      "status check",
      accessToken,
    );
    return d.status_code ?? "IN_PROGRESS";
  }

  async publishContainer(accessToken: string, userId: string, containerId: string) {
    const d = await this.postForm<{ id: string }>(
      `${INSTAGRAM_GRAPH}/${userId}/media_publish`,
      { creation_id: containerId },
      "publish",
      accessToken,
    );
    return { mediaId: d.id };
  }

  async permalink(accessToken: string, mediaId: string) {
    const d = await this.getJson<{ permalink?: string }>(
      `${INSTAGRAM_GRAPH}/${mediaId}?fields=permalink`,
      "permalink lookup",
      accessToken,
    );
    return d.permalink;
  }
}
