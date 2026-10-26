/** Result of running one marketplace's review checklist (same shape as the MCP directory checks in apps/mcp). */
export interface ChecklistResult {
  directory: string;
  /** Items that fail. Empty means the automated part of the review passes. */
  errors: string[];
  /** Things the review needs that only the owner can supply (accounts, logos, legal pages). */
  ownerInputs: string[];
}

const SMALL = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
]);

/** "watch new brief ideas" → "Watch New Brief Ideas" (small words stay lower case unless first). */
export function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w, i) =>
      i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}
