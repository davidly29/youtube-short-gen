/**
 * Only what we need: upload videos, read the channel they go to, and read that channel's own analytics
 * (E10-01, read-only; channels connected before it was added keep publishing and are asked to reconnect
 * for stats).
 */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

export interface YouTubeOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. https://app.example.com/api/channels/youtube/callback */
  redirectUri: string;
}

/** One of the creator's own uploads: text metadata only, never the media (E4-03). */
export interface OwnVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  privacyStatus: "public" | "unlisted" | "private";
}

export interface YouTubeChannel {
  id: string;
  title: string;
  avatarUrl?: string;
}

/** What we send in videos.insert (snippet + status). */
export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "public" | "unlisted" | "private";
  /** RFC 3339; YouTube requires privacyStatus "private" for scheduled videos. */
  publishAt?: string;
  /** "Altered or synthetic content" disclosure. */
  containsSyntheticMedia: boolean;
  selfDeclaredMadeForKids: boolean;
}

export interface UploadInput {
  accessToken: string;
  filePath: string;
  metadata: VideoMetadata;
  /** A resumable session from an earlier attempt: continue it instead of starting a second upload. */
  sessionUrl?: string;
  /** Called as soon as a session exists, so the caller can persist it before any bytes move. */
  onSession?: (url: string) => Promise<void> | void;
}

/** The user's grant expired or was revoked: they must connect the channel again. */
export class ReconnectRequired extends Error {
  constructor(message = "YouTube access expired. Reconnect the channel to keep publishing.") {
    super(message);
  }
}

/** The daily upload quota is used up; try again in the next quota window. */
export class QuotaExceeded extends Error {}

export interface YouTubeClient {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string; scopes: string[] }>;
  /** Fresh access token from a refresh token; throws ReconnectRequired when the grant is gone. */
  accessToken(refreshToken: string): Promise<string>;
  revoke(token: string): Promise<void>;
  myChannel(accessToken: string): Promise<YouTubeChannel>;
  upload(input: UploadInput): Promise<{ videoId: string }>;
  /**
   * The authorised channel's most recent uploads (newest first, up to `max`, at most 50): titles and
   * descriptions only. Costs 3 quota units with `youtube.readonly`.
   */
  myVideos(accessToken: string, max?: number): Promise<OwnVideo[]>;
}

export const videoUrl = (videoId: string) => `https://www.youtube.com/shorts/${videoId}`;
