import type { CaptionStyleId } from "@shortloop/contracts";
import type { CreateShortInput } from "@shortloop/mcp";
import type { z } from "zod";

// Type-only imports: this file is bundled into the Zapier app, which must not carry the MCP server or zod.

/**
 * The "Create Short" fields every integration offers. One list, so Zapier, Make and the calendar import ask for the
 * same things with the same help text. Each key is a field of the public API's `POST /shorts` body (the MCP
 * `create_short` input); `fields.test.ts` proves it.
 */
export interface CreateShortField {
  key: keyof z.input<typeof CreateShortInput>;
  label: string;
  helpText: string;
  required?: boolean;
  type: "string" | "text" | "integer";
  choices?: { value: string; label: string }[];
  default?: string;
}

export const LENGTH_CHOICES = [
  { value: "30", label: "30 seconds" },
  { value: "45", label: "45 seconds" },
  { value: "60", label: "60 seconds" },
];

const CAPTION_LABELS: Record<CaptionStyleId, string> = {
  "bold-pop": "Bold pop",
  "clean-subtitle": "Clean subtitle",
  "highlight-word": "Highlight word",
  karaoke: "Karaoke",
  boxed: "Boxed",
  minimal: "Minimal",
};

export const CAPTION_CHOICES = Object.entries(CAPTION_LABELS).map(([value, label]) => ({ value, label }));

export const CREATE_SHORT_FIELDS: CreateShortField[] = [
  {
    key: "topic",
    label: "Topic",
    type: "text",
    required: true,
    helpText: "What the Short is about, e.g. 'why octopuses have three hearts' (3–300 characters).",
  },
  {
    key: "angle",
    label: "Angle",
    type: "text",
    helpText: "Optional take or framing for the script.",
  },
  {
    key: "length_seconds",
    label: "Length",
    type: "integer",
    choices: LENGTH_CHOICES,
    default: "45",
    helpText: "How long the Short should be: 30, 45 or 60 seconds.",
  },
  {
    key: "tone",
    label: "Tone",
    type: "string",
    default: "curious",
    helpText: "How the narration should sound, e.g. curious, upbeat, serious.",
  },
  {
    key: "caption_style",
    label: "Caption Style",
    type: "string",
    choices: CAPTION_CHOICES,
    default: "bold-pop",
    helpText: "How captions look on the video.",
  },
  {
    key: "image_style",
    label: "Image Style",
    type: "string",
    default: "cinematic",
    helpText: "Look for AI images: photoreal, cinematic, 3d, hand-drawn, whiteboard, storyboard or anime.",
  },
  {
    key: "voice_id",
    label: "Voice",
    type: "string",
    helpText: "Narrator voice. Leave empty for your default voice.",
  },
  {
    key: "channel_voice_id",
    label: "Channel Voice",
    type: "string",
    helpText: "Write the script in the learned voice of one of your connected channels.",
  },
  {
    key: "topic_id",
    label: "Brief Idea ID",
    type: "string",
    helpText: "The Topic ID from a New Brief Idea trigger, so the idea drops out of later briefs.",
  },
];

/**
 * Turn loose string values (from a Zap, a Make scenario or a spreadsheet row) into a `POST /shorts` body: empty
 * values are dropped and the length becomes a number. Validation is left to `CreateShortInput`.
 */
export function toCreateShortBody(values: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of CREATE_SHORT_FIELDS) {
    const raw = values[f.key];
    if (raw === undefined || raw === null) continue;
    const v = typeof raw === "string" ? raw.trim() : raw;
    if (v === "") continue;
    body[f.key] = f.type === "integer" && typeof v === "string" ? parseLength(v) : v;
  }
  return body;
}

/** "45", "45s", "45 sec", "45 seconds", "0:45" → 45. Anything else comes back as NaN so validation reports it. */
export function parseLength(v: string): number {
  const s = v.trim().toLowerCase();
  const mmss = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const m = /^(\d+)\s*(s|sec|secs|second|seconds)?$/.exec(s);
  return m ? Number(m[1]) : Number.NaN;
}
