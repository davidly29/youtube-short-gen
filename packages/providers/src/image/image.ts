export type Aspect = "9:16" | "16:9" | "1:1";

export interface ImageRequest {
  prompt: string;
  aspect: Aspect;
  /** Visual style preset id or free text, appended to the prompt. */
  style?: string;
  seed?: number;
  outDir: string;
}

export interface ImageResult {
  path: string;
  provider: string;
  model: string;
  /** The full prompt actually sent (prompt + style). */
  prompt: string;
}

export interface ImageGen {
  readonly provider: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export const STYLE_PRESETS: Record<string, string> = {
  photoreal: "photorealistic, natural light, 35mm photo, high detail",
  cinematic: "cinematic film still, dramatic lighting, shallow depth of field",
  "3d": "stylized 3D render, soft global illumination, clay-like materials",
  "hand-drawn": "hand-drawn ink and watercolor illustration",
  whiteboard: "black marker whiteboard doodle on white background, simple line art",
  storyboard: "pencil storyboard frame, rough shading, grayscale",
  anime: "anime key visual, vibrant colors, clean line art",
};

export function fullPrompt(prompt: string, style?: string): string {
  const s = style ? (STYLE_PRESETS[style] ?? style) : "";
  return [prompt.trim(), s].filter(Boolean).join(", ");
}

/** Generation size: about one megapixel at the requested aspect, multiples of 64. */
export function generationSize(aspect: Aspect): { width: number; height: number } {
  const [w, h] = aspect === "9:16" ? [9, 16] : aspect === "16:9" ? [16, 9] : [1, 1];
  const scale = Math.sqrt(1_000_000 / (w * h));
  return { width: Math.floor((w * scale) / 64) * 64, height: Math.floor((h * scale) / 64) * 64 };
}

/**
 * Prompts that name real people or trademarked characters/brands are refused before any provider call.
 * This is a first line of defence; @shortloop/pipeline's policy check runs on scripts too.
 */
const BLOCKED: RegExp[] = [
  /\b(taylor swift|elon musk|donald trump|joe biden|kamala harris|barack obama|beyonc[eé]|kim kardashian|mr\.? ?beast|cristiano ronaldo|lionel messi|king charles|pope)\b/i,
  /\b(mickey mouse|spider-?man|batman|superman|pikachu|pok[eé]mon|mario|sonic the hedgehog|harry potter|darth vader|elsa|shrek|spongebob|minions?)\b/i,
  /\b(disney|marvel|nintendo|coca-?cola|nike|apple logo|mcdonald'?s|starbucks|lego)\b/i,
  /\b(in the style of|as drawn by)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/,
];

export function checkImagePrompt(prompt: string): { ok: boolean; reason?: string } {
  for (const re of BLOCKED) {
    const m = re.exec(prompt);
    if (m) return { ok: false, reason: `prompt names a real person, character or brand ("${m[0]}")` };
  }
  return { ok: true };
}

export class ImagePromptRejected extends Error {}
