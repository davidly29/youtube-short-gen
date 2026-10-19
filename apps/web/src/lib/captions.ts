/** Caption presets shown in the studio and offered to MCP agents (ids match packages/render presets). */
export const CAPTION_STYLES = [
  { id: "bold-pop", label: "Bold pop", hint: "Big uppercase, spoken word pops" },
  { id: "highlight-word", label: "Highlight", hint: "Spoken word turns green" },
  { id: "karaoke", label: "Karaoke", hint: "Words fill as they're said" },
  { id: "clean-subtitle", label: "Clean", hint: "Simple subtitles" },
  { id: "boxed", label: "Boxed", hint: "Text on a dark box" },
  { id: "minimal", label: "Minimal", hint: "Small and low" },
] as const;
