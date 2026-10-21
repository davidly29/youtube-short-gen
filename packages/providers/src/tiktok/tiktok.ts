/**
 * TikTok Login Kit + Content Posting API (Direct Post), E8-03. Only what posting needs:
 * read the creator's basic profile and publish videos to their account.
 */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"] as const;

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  /** e.g. https://app.example.com/publish/tiktok/callback */
  redirectUri: string;
}

/** Values TikTok accepts for `post_info.privacy_level`; the creator's own subset comes from `creator_info`. */
export const TIKTOK_PRIVACY = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];

export const PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export interface TikTokGrant {
  accessToken: string;
  /** TikTok may rotate it on refresh: always store the latest one. */
  refreshToken: string;
  openId: string;
  scopes: string[];
}

export interface TikTokUser {
  openId: string;
  displayName: string;
  avatarUrl?: string;
}

/** `creator_info/query`: must be called before rendering the post form (TikTok content-sharing guidelines). */
export interface CreatorInfo {
  avatarUrl?: string;
  username: string;
  nickname: string;
  privacyLevelOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export interface DirectPostInput {
  accessToken: string;
  /** A signed, time-limited URL on a domain verified in the TikTok developer portal. */
  videoUrl: string;
  title: string;
  privacyLevel: TikTokPrivacy;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** "Branded content": promoting a third party (Paid partnership label). */
  brandContentToggle: boolean;
  /** "Your brand": promoting the creator's own business (Promotional content label). */
  brandOrganicToggle: boolean;
  /** TikTok's AI-generated content label. */
  isAigc: boolean;
}

export type PostState =
  "PROCESSING_DOWNLOAD" | "PROCESSING_UPLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";

export interface PostStatus {
  status: PostState;
  failReason?: string;
  /** Public post ids, once TikTok has published and moderated the video. */
  postIds: string[];
}

/** The grant expired or was revoked: the user must connect TikTok again. */
export class TikTokReconnectRequired extends Error {
  constructor(message = "TikTok access expired. Reconnect your TikTok account to keep posting.") {
    super(message);
  }
}

/** TikTok says this creator can't post right now (posting cap, spam risk, banned): show it and stop. */
export class TikTokCannotPost extends Error {}

/** API rate limit: try again in a minute. */
export class TikTokRateLimited extends Error {}

export interface TikTokClient {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<TikTokGrant>;
  /** Fresh tokens from a refresh token; throws TikTokReconnectRequired when the grant is gone. */
  refresh(refreshToken: string): Promise<TikTokGrant>;
  revoke(accessToken: string): Promise<void>;
  userInfo(accessToken: string): Promise<TikTokUser>;
  creatorInfo(accessToken: string): Promise<CreatorInfo>;
  /** Direct Post with `PULL_FROM_URL`: TikTok downloads the file itself. Returns the publish id. */
  directPost(input: DirectPostInput): Promise<{ publishId: string }>;
  postStatus(accessToken: string, publishId: string): Promise<PostStatus>;
}

export const tiktokVideoUrl = (username: string, postId: string) =>
  `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${postId}`;

// ---------------------------------------------------------------------------------------------------------------
// The post form's rules, from TikTok's content-sharing guidelines (docs/tiktok-audit.md). The UI renders from
// these and the server re-checks them, so a hand-crafted request can't skip a step.

/** TikTok's title (caption) limit, in UTF-16 code units. */
export const TIKTOK_TITLE_MAX = 2200;

export interface TikTokPostForm {
  title: string;
  /** No default: the user must pick one. */
  privacyLevel?: TikTokPrivacy;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** "Disclose video content" toggle. */
  commercial: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  /** AI-generated label; forced on when the Short needs it. */
  aiGenerated: boolean;
  /** The user ticked the declaration and pressed Post themselves. */
  consent: boolean;
}

export interface TikTokPostContext {
  creator: CreatorInfo;
  /** Until TikTok approves our audit, Direct Post only allows SELF_ONLY. */
  audited: boolean;
  videoDurationSec: number;
  aiRequired: boolean;
}

/** Privacy options the form may offer: the creator's, narrowed to "Only me" while unaudited. */
export function allowedPrivacy(ctx: Pick<TikTokPostContext, "creator" | "audited">): TikTokPrivacy[] {
  const opts = ctx.creator.privacyLevelOptions.filter((p) => TIKTOK_PRIVACY.includes(p));
  return ctx.audited ? opts : opts.filter((p) => p === "SELF_ONLY");
}

/** The label TikTok will show, so the user sees it before posting. */
export function commercialLabel(form: Pick<TikTokPostForm, "commercial" | "yourBrand" | "brandedContent">) {
  if (!form.commercial) return undefined;
  if (form.brandedContent) return "Paid partnership" as const;
  if (form.yourBrand) return "Promotional content" as const;
  return undefined;
}

export const MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const BRANDED_CONTENT_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

/** Which agreements the declaration above the Post button must name. */
export type DeclarationPart = "branded_content_policy" | "music_usage";

export function declarationParts(
  form: Pick<TikTokPostForm, "commercial" | "brandedContent">,
): DeclarationPart[] {
  return form.commercial && form.brandedContent ? ["branded_content_policy", "music_usage"] : ["music_usage"];
}

/** Every reason the post can't go yet, in the order the form shows them. Empty means "Post" may be pressed. */
export function tiktokPostProblems(form: TikTokPostForm, ctx: TikTokPostContext): string[] {
  const out: string[] = [];
  if (ctx.videoDurationSec > ctx.creator.maxVideoPostDurationSec)
    out.push(
      `This Short is ${Math.ceil(ctx.videoDurationSec)}s; your TikTok account can post up to ${ctx.creator.maxVideoPostDurationSec}s.`,
    );
  if (form.title.length > TIKTOK_TITLE_MAX)
    out.push(`Keep the caption under ${TIKTOK_TITLE_MAX} characters.`);
  if (!form.privacyLevel) out.push("Choose who can view this video.");
  else if (!allowedPrivacy(ctx).includes(form.privacyLevel))
    out.push(
      ctx.audited
        ? "That visibility isn't available for your TikTok account."
        : "Until TikTok approves ShortLoop, posts can only be private (Only me).",
    );
  if (form.allowComment && ctx.creator.commentDisabled) out.push("Comments are turned off for your account.");
  if (form.allowDuet && ctx.creator.duetDisabled) out.push("Duets are turned off for your account.");
  if (form.allowStitch && ctx.creator.stitchDisabled) out.push("Stitches are turned off for your account.");
  if (form.commercial && !form.yourBrand && !form.brandedContent)
    out.push("You need to indicate if your content promotes yourself, a third party, or both.");
  if (form.commercial && form.brandedContent && form.privacyLevel === "SELF_ONLY")
    out.push("Branded content visibility can't be set to private.");
  if (ctx.aiRequired && !form.aiGenerated) out.push("This Short must carry TikTok's AI-generated label.");
  if (!form.consent) out.push("Confirm the declaration to post.");
  return out;
}

/** The API body for a checked form. Interaction switches are inverted (TikTok takes `disable_*`). */
export function toDirectPost(
  form: TikTokPostForm,
  ctx: TikTokPostContext,
  accessToken: string,
  videoUrl: string,
): DirectPostInput {
  const problems = tiktokPostProblems(form, ctx);
  if (problems.length) throw new Error(problems.join(" "));
  return {
    accessToken,
    videoUrl,
    title: form.title,
    privacyLevel: form.privacyLevel as TikTokPrivacy,
    disableComment: !form.allowComment,
    disableDuet: !form.allowDuet,
    disableStitch: !form.allowStitch,
    brandContentToggle: form.commercial && form.brandedContent,
    brandOrganicToggle: form.commercial && form.yourBrand,
    isAigc: form.aiGenerated || ctx.aiRequired,
  };
}
