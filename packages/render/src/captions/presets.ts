import type { CaptionStyleId, CaptionWord } from "@shortloop/contracts";

/** Colours are ASS &HAABBGGRR. */
interface Preset {
  description: string;
  font: string;
  /** Font size as a fraction of frame width. */
  size: number;
  upper: boolean;
  wordsPerPage: 1 | 2 | 3;
  primary: string;
  outline: string;
  back: string;
  borderStyle: 1 | 3;
  outlineWidth: number;
  shadow: number;
  bold: boolean;
  /** Distance of the text's baseline from the bottom edge, as a fraction of height (≥ 0.20 keeps the safe area clear). */
  bottom: number;
  /** How the word being spoken is shown. */
  active: "none" | "colour" | "colour+scale" | "karaoke";
  accent: string;
}

const ACCENT_YELLOW = "&H0000E5FF";
const ACCENT_GREEN = "&H0050FF39";

export const CAPTION_PRESETS: Record<CaptionStyleId, Preset> = {
  "bold-pop": {
    description: "Big uppercase words, thick outline, the spoken word pops in yellow",
    font: "DejaVu Sans",
    size: 0.085,
    upper: true,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
    outlineWidth: 7,
    shadow: 0,
    bold: true,
    bottom: 0.4,
    active: "colour+scale",
    accent: ACCENT_YELLOW,
  },
  "clean-subtitle": {
    description: "Sentence-case white text with a soft shadow",
    font: "DejaVu Sans",
    size: 0.06,
    upper: false,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outlineWidth: 3,
    shadow: 2,
    bold: true,
    bottom: 0.32,
    active: "none",
    accent: ACCENT_YELLOW,
  },
  "highlight-word": {
    description: "White phrase; the spoken word turns green",
    font: "DejaVu Sans",
    size: 0.075,
    upper: true,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
    outlineWidth: 6,
    shadow: 0,
    bold: true,
    bottom: 0.38,
    active: "colour",
    accent: ACCENT_GREEN,
  },
  karaoke: {
    description: "Words fill with colour as they are spoken",
    font: "DejaVu Sans",
    size: 0.07,
    upper: false,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
    outlineWidth: 5,
    shadow: 0,
    bold: true,
    bottom: 0.36,
    active: "karaoke",
    accent: ACCENT_YELLOW,
  },
  boxed: {
    description: "White text on a dark box, calm and readable",
    font: "DejaVu Sans",
    size: 0.058,
    upper: false,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H40181818",
    back: "&H40181818",
    borderStyle: 3,
    outlineWidth: 16,
    shadow: 0,
    bold: true,
    bottom: 0.3,
    active: "none",
    accent: ACCENT_YELLOW,
  },
  minimal: {
    description: "Small single line just above the safe area",
    font: "DejaVu Sans",
    size: 0.045,
    upper: false,
    wordsPerPage: 3,
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
    outlineWidth: 2,
    shadow: 1,
    bold: false,
    bottom: 0.235,
    active: "none",
    accent: ACCENT_YELLOW,
  },
};

/** Platform UI covers the bottom 20% and right 15% of a vertical video. */
export const SAFE_AREA = { bottom: 0.2, right: 0.15 } as const;

const ts = (ms: number) => {
  const t = Math.max(0, ms) / 1000;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
};

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "");

/** 1–3 words per page; a page ends early after sentence punctuation or a pause over 600 ms. */
export function paginate(words: CaptionWord[], perPage: number): CaptionWord[][] {
  const pages: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (cur.length >= perPage || /[.!?]$/.test(w.text) || (next && next.startMs - w.endMs > 600)) {
      pages.push(cur);
      cur = [];
    }
  });
  if (cur.length) pages.push(cur);
  return pages;
}

/** Build an ASS subtitle file for the given caption words and preset. */
export function buildAss(words: CaptionWord[], style: CaptionStyleId, width = 1080, height = 1920): string {
  const p = CAPTION_PRESETS[style];
  const side = Math.round(width * SAFE_AREA.right) + 24;
  const marginV = Math.round(height * p.bottom);
  const fontSize = Math.round(width * p.size);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${p.font},${fontSize},${p.primary},${p.accent},${p.outline},${p.back},${p.bold ? -1 : 0},0,0,0,100,100,0,0,${p.borderStyle},${p.outlineWidth},${p.shadow},2,${side},${side},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  const text = (w: CaptionWord) => esc(p.upper ? w.text.toUpperCase() : w.text);
  const emph = (w: CaptionWord, t: string) => (w.emphasis ? `{\\c${p.accent}}${t}{\\r}` : t);
  for (const page of paginate(words, p.wordsPerPage)) {
    const first = page[0];
    const last = page[page.length - 1];
    if (!first || !last) continue;
    const pageEnd = last.endMs + 120;
    if (p.active === "none") {
      lines.push(
        `Dialogue: 0,${ts(first.startMs)},${ts(pageEnd)},Cap,,0,0,0,,${page.map((w) => emph(w, text(w))).join(" ")}`,
      );
      continue;
    }
    if (p.active === "karaoke") {
      const k = page.map((w, i) => {
        const next = page[i + 1];
        const cs = Math.max(1, Math.round(((next ? next.startMs : w.endMs) - w.startMs) / 10));
        return `{\\kf${cs}}${text(w)}`;
      });
      // Secondary colour is the "before" fill; swap so words fill white -> accent.
      lines.push(
        `Dialogue: 0,${ts(first.startMs)},${ts(pageEnd)},Cap,,0,0,0,,{\\1c${p.accent}\\2c${p.primary}}${k.join(" ")}`,
      );
      continue;
    }
    const scale = p.active === "colour+scale" ? "\\fscx115\\fscy115" : "";
    page.forEach((w, i) => {
      const next = page[i + 1];
      const end = next ? next.startMs : pageEnd;
      const body = page
        .map((x, j) => (j === i ? `{\\c${p.accent}${scale}}${text(x)}{\\r}` : emph(x, text(x))))
        .join(" ");
      lines.push(`Dialogue: 0,${ts(w.startMs)},${ts(end)},Cap,,0,0,0,,${body}`);
    });
  }
  return `${header.join("\n")}\n${lines.join("\n")}\n`;
}
