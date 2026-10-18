import type { PublishRequest } from "@shortloop/contracts";
import { withAttribution, type RightsManifest } from "./rights";

export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
/** YouTube caps the combined tag text at 500 characters. */
export const YOUTUBE_TAGS_MAX_CHARS = 500;
/** "People & Blogs": a neutral default category; users don't pick one yet. */
export const YOUTUBE_DEFAULT_CATEGORY = "22";
/** Uploads per day before we hold the rest for the next quota window (overridable per deployment). */
export const DEFAULT_DAILY_UPLOAD_LIMIT = 100;

/** Image styles that look like real footage. AI images in these styles need the synthetic-content label. */
export const REALISTIC_IMAGE_STYLES = new Set(["photoreal", "cinematic"]);
/** Voice providers whose voices can pass for (or clone) a real person. */
export const REALISTIC_VOICE_PROVIDERS = new Set(["elevenlabs"]);

/**
 * Whether YouTube's "altered or synthetic content" label is required: realistic-looking AI images, or a voice
 * that could pass for a real person. The user may always add the label; they can't remove a required one.
 */
export function requiresAiDisclosure(input: {
  manifest: RightsManifest;
  imageStyle?: string;
  voiceProvider?: string;
}): boolean {
  const aiImages = input.manifest.entries.some((e) => e.source === "ai_generated" && e.kind === "image");
  const aiVoice = input.manifest.entries.some(
    (e) =>
      e.kind === "audio" &&
      e.source === "ai_generated" &&
      REALISTIC_VOICE_PROVIDERS.has(e.licence?.provider ?? ""),
  );
  return (
    (aiImages && REALISTIC_IMAGE_STYLES.has(input.imageStyle ?? "")) ||
    aiVoice ||
    (input.voiceProvider !== undefined && REALISTIC_VOICE_PROVIDERS.has(input.voiceProvider))
  );
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "public" | "unlisted" | "private";
  publishAt?: string;
  containsSyntheticMedia: boolean;
  selfDeclaredMadeForKids: boolean;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * videos.insert metadata for a Short: title ≤ 100 chars, `#Shorts` in the description, licence attributions
 * appended, scheduled posts private with `publishAt`, synthetic-content label when required (or asked for).
 */
export function youtubeMetadata(
  req: PublishRequest,
  manifest: RightsManifest,
  aiRequired: boolean,
): YouTubeMetadata {
  let description = req.description.trim();
  if (!/#shorts\b/i.test(description)) description = description ? `${description}\n\n#Shorts` : "#Shorts";
  description = withAttribution(description, manifest);
  if (description.length > YOUTUBE_DESCRIPTION_MAX) {
    // Credits are a licence requirement: trim the user's text, never the attributions.
    const credits = withAttribution("", manifest);
    const room = YOUTUBE_DESCRIPTION_MAX - credits.length - "\n\n#Shorts\n\n".length;
    description = withAttribution(`${clip(req.description.trim(), Math.max(0, room))}\n\n#Shorts`, manifest);
  }
  const tags: string[] = [];
  let chars = 0;
  for (const t of req.tags.map((x) => x.trim().replace(/^#/, "")).filter(Boolean)) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (chars + cost > YOUTUBE_TAGS_MAX_CHARS) break;
    tags.push(t);
    chars += cost;
  }
  const scheduled = Boolean(req.scheduledAt && new Date(req.scheduledAt).getTime() > Date.now());
  return {
    title: clip(req.title.trim(), YOUTUBE_TITLE_MAX),
    description,
    tags,
    categoryId: YOUTUBE_DEFAULT_CATEGORY,
    privacyStatus: scheduled ? "private" : req.privacy,
    publishAt: scheduled ? new Date(req.scheduledAt as string).toISOString() : undefined,
    containsSyntheticMedia: aiRequired || req.aiDisclosure,
    selfDeclaredMadeForKids: false,
  };
}

/** YouTube's daily quota resets at midnight Pacific Time. */
const PT = "America/Los_Angeles";

function ptOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PT, timeZoneName: "longOffset" }).formatToParts(
    at,
  );
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(off);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -480;
}

/** The quota day (YYYY-MM-DD in Pacific Time) that `at` falls in. */
export function quotaDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** When the next quota window opens: the next midnight Pacific Time, as a UTC instant. */
export function nextQuotaWindow(at: Date): Date {
  const [y, m, d] = quotaDay(at).split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return new Date(guess.getTime() - ptOffsetMinutes(guess) * 60_000);
}

/** When the current quota day began (handles 23- and 25-hour days at DST changes). */
export function quotaDayStart(at: Date): Date {
  return nextQuotaWindow(new Date(nextQuotaWindow(at).getTime() - 26 * 3_600_000));
}
