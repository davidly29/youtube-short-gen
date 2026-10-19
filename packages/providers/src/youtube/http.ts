import { readFile, stat } from "node:fs/promises";
import {
  QuotaExceeded,
  ReconnectRequired,
  YOUTUBE_SCOPES,
  type UploadInput,
  type YouTubeChannel,
  type YouTubeClient,
  type YouTubeOAuthConfig,
} from "./youtube";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

interface GoogleError {
  error?: string | { code?: number; message?: string; errors?: { reason?: string }[] };
  error_description?: string;
}

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "uploadLimitExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
]);

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as GoogleError;
  const err = typeof body.error === "object" ? body.error : undefined;
  const reason = err?.errors?.[0]?.reason;
  if (body.error === "invalid_grant" || res.status === 401) throw new ReconnectRequired();
  if (reason && QUOTA_REASONS.has(reason)) throw new QuotaExceeded(`YouTube quota: ${reason}`);
  const message =
    err?.message ?? body.error_description ?? (typeof body.error === "string" ? body.error : "");
  throw new Error(`YouTube ${what} failed (${res.status})${message ? `: ${message.slice(0, 200)}` : ""}`);
}

/** YouTube Data API v3 over plain HTTP (injectable fetch for cassette tests). */
export class HttpYouTube implements YouTubeClient {
  constructor(
    private readonly config: YouTubeOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authUrl(state: string): string {
    const u = new URL(AUTH);
    u.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline", // refresh token, so scheduled and retried uploads work while the user is away
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return u.toString();
  }

  private async token(params: Record<string, string>, what: string) {
    const res = await this.fetchImpl(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    });
    if (!res.ok) await fail(res, what);
    return (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
  }

  async exchangeCode(code: string) {
    const t = await this.token(
      { grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri },
      "sign-in",
    );
    if (!t.refresh_token)
      throw new Error("Google didn't return offline access. Please try connecting again.");
    const scopes = (t.scope ?? "").split(" ").filter(Boolean);
    if (!scopes.includes(YOUTUBE_SCOPES[0])) {
      throw new Error(
        'Upload permission wasn\'t granted. Connect again and allow "Manage your YouTube videos".',
      );
    }
    return { refreshToken: t.refresh_token, accessToken: t.access_token, scopes };
  }

  async accessToken(refreshToken: string): Promise<string> {
    return (await this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, "token refresh"))
      .access_token;
  }

  async revoke(token: string): Promise<void> {
    await this.fetchImpl(REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }); // best effort: a token that's already invalid is as good as revoked
  }

  async myChannel(accessToken: string): Promise<YouTubeChannel> {
    const res = await this.fetchImpl(`${API}/channels?part=snippet&mine=true`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) await fail(res, "channel lookup");
    const data = (await res.json()) as {
      items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[];
    };
    const ch = data.items?.[0];
    if (!ch)
      throw new Error(
        "This Google account has no YouTube channel yet. Create one on YouTube, then connect again.",
      );
    return { id: ch.id, title: ch.snippet.title, avatarUrl: ch.snippet.thumbnails?.default?.url };
  }

  /** Resumable upload: start (or resume) a session, then send the remaining bytes. */
  async upload(input: UploadInput): Promise<{ videoId: string }> {
    const size = (await stat(input.filePath)).size;
    const auth = { authorization: `Bearer ${input.accessToken}` };
    let session = input.sessionUrl;
    let offset = 0;

    if (session) {
      const probe = await this.fetchImpl(session, {
        method: "PUT",
        headers: { ...auth, "content-length": "0", "content-range": `bytes */${size}` },
      });
      if (probe.status === 200 || probe.status === 201)
        return { videoId: ((await probe.json()) as { id: string }).id };
      if (probe.status === 308) {
        const range = /bytes=0-(\d+)/.exec(probe.headers.get("range") ?? "");
        offset = range?.[1] ? Number(range[1]) + 1 : 0;
      } else if (probe.status === 404 || probe.status === 410) {
        session = undefined; // expired session: nothing was published, start a new one
      } else {
        await fail(probe, "upload resume");
      }
    }

    if (!session) {
      const start = await this.fetchImpl(UPLOAD, {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": "video/mp4",
          "x-upload-content-length": String(size),
        },
        body: JSON.stringify({
          snippet: {
            title: input.metadata.title,
            description: input.metadata.description,
            tags: input.metadata.tags,
            categoryId: input.metadata.categoryId,
          },
          status: {
            privacyStatus: input.metadata.privacyStatus,
            publishAt: input.metadata.publishAt,
            containsSyntheticMedia: input.metadata.containsSyntheticMedia,
            selfDeclaredMadeForKids: input.metadata.selfDeclaredMadeForKids,
          },
        }),
      });
      if (!start.ok) await fail(start, "upload start");
      session = start.headers.get("location") ?? undefined;
      if (!session) throw new Error("YouTube didn't return an upload session");
      await input.onSession?.(session);
    }

    const bytes = (await readFile(input.filePath)).subarray(offset);
    const put = await this.fetchImpl(session, {
      method: "PUT",
      headers: {
        ...auth,
        "content-type": "video/mp4",
        "content-length": String(bytes.length),
        "content-range": `bytes ${offset}-${size - 1}/${size}`,
      },
      body: bytes,
    });
    if (!put.ok) await fail(put, "upload");
    return { videoId: ((await put.json()) as { id: string }).id };
  }
}
