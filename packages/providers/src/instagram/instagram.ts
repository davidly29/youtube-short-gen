/**
 * Instagram API with Instagram Login: publish Reels to Professional (Business / Creator) accounts, E8-04.
 */
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;

export interface InstagramOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. https://app.example.com/publish/instagram/callback */
  redirectUri: string;
}

export interface InstagramGrant {
  /** Long-lived (60-day) token; refresh it before it expires. */
  accessToken: string;
  userId: string;
  expiresInS: number;
  scopes: string[];
}

export type InstagramAccountType = "BUSINESS" | "MEDIA_CREATOR" | "PERSONAL";

export interface InstagramAccount {
  userId: string;
  username: string;
  accountType: InstagramAccountType;
  avatarUrl?: string;
}

/** Container states from `GET /{container-id}?fields=status_code`. */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export interface PublishingLimit {
  used: number;
  total: number;
  /** Rolling window length in seconds (24 h). */
  windowS: number;
}

export interface ReelInput {
  accessToken: string;
  userId: string;
  /** A signed, publicly fetchable URL; Instagram downloads the file itself. */
  videoUrl: string;
  caption: string;
  shareToFeed?: boolean;
}

/** Instagram only lets apps publish to Professional accounts. */
export const SWITCH_TO_PROFESSIONAL =
  "Instagram only lets apps publish to Professional accounts. In Instagram, open Settings → Account type and tools → Switch to professional account (Creator or Business), then connect again.";

export class ProfessionalAccountRequired extends Error {
  constructor() {
    super(SWITCH_TO_PROFESSIONAL);
  }
}

/** The token expired or was revoked: connect Instagram again. */
export class InstagramReconnectRequired extends Error {
  constructor(message = "Instagram access expired. Reconnect your Instagram account to keep posting.") {
    super(message);
  }
}

/** API rate limit or the 24-hour publishing limit: queue the post for the next window. */
export class InstagramRateLimited extends Error {}

export interface InstagramClient {
  authUrl(state: string): string;
  /** Code -> short-lived token -> long-lived token. */
  exchangeCode(code: string): Promise<InstagramGrant>;
  refresh(accessToken: string): Promise<InstagramGrant>;
  me(accessToken: string): Promise<InstagramAccount>;
  publishingLimit(accessToken: string, userId: string): Promise<PublishingLimit>;
  createReelContainer(input: ReelInput): Promise<{ containerId: string }>;
  containerStatus(accessToken: string, containerId: string): Promise<ContainerStatus>;
  publishContainer(accessToken: string, userId: string, containerId: string): Promise<{ mediaId: string }>;
  permalink(accessToken: string, mediaId: string): Promise<string | undefined>;
}

/** Personal accounts can't be published to: fail with the "switch to Professional" message. */
export function assertProfessional(account: InstagramAccount): InstagramAccount {
  if (account.accountType !== "BUSINESS" && account.accountType !== "MEDIA_CREATOR")
    throw new ProfessionalAccountRequired();
  return account;
}

export type ReelResult =
  | { status: "published"; mediaId: string; permalink?: string }
  | { status: "scheduled_next_window"; retryAt: string; reason: string };

export interface PublishReelOptions {
  /** Status polls: once a minute, at most 5 minutes (defaults). */
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** How long to wait before trying again after a rate limit (default 1 h; the limits are rolling windows). */
  retryAfterMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The whole Reels flow: check `content_publishing_limit`, create a REELS container, poll it once a minute for at
 * most 5 minutes, then publish. A rate limit or a used-up publishing limit returns `scheduled_next_window` (the
 * caller re-queues the post) instead of failing.
 */
export async function publishReel(
  ig: InstagramClient,
  input: ReelInput,
  opts: PublishReelOptions = {},
): Promise<ReelResult> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? realSleep;
  const interval = opts.pollIntervalMs ?? 60_000;
  const maxPolls = opts.maxPolls ?? 5;
  const later = (reason: string): ReelResult => ({
    status: "scheduled_next_window",
    retryAt: new Date(now().getTime() + (opts.retryAfterMs ?? 3_600_000)).toISOString(),
    reason,
  });
  try {
    const limit = await ig.publishingLimit(input.accessToken, input.userId);
    if (limit.used >= limit.total)
      return later(`Instagram's limit of ${limit.total} posts per 24 hours is used up for this account.`);
    const { containerId } = await ig.createReelContainer(input);
    let status: ContainerStatus = "IN_PROGRESS";
    for (let i = 0; i < maxPolls; i++) {
      await sleep(interval);
      status = await ig.containerStatus(input.accessToken, containerId);
      if (status !== "IN_PROGRESS") break;
    }
    if (status === "ERROR") throw new Error("Instagram couldn't process this video.");
    if (status === "EXPIRED")
      throw new Error("Instagram's upload expired before it was published. Try again.");
    if (status === "IN_PROGRESS")
      throw new Error(
        `Instagram was still processing the video after ${Math.round((interval * maxPolls) / 60_000)} minutes.`,
      );
    const { mediaId } = await ig.publishContainer(input.accessToken, input.userId, containerId);
    const permalink = await ig.permalink(input.accessToken, mediaId).catch(() => undefined);
    return { status: "published", mediaId, permalink };
  } catch (e) {
    if (e instanceof InstagramRateLimited) return later(e.message);
    throw e;
  }
}
