import { createHash, timingSafeEqual } from "node:crypto";

/** A beta access code from SHORTLOOP_ACCESS_CODES ("CODE:maxUses,OTHER:10"). Codes match case-insensitively. */
export interface AccessCode {
  code: string;
  maxUses: number;
}

export const DEFAULT_MAX_USES = 25;

export function parseAccessCodes(raw: string | undefined): AccessCode[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [code = "", max] = entry.split(":");
      const n = Number(max);
      return { code: code.trim(), maxUses: Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USES };
    })
    .filter((c) => c.code.length >= 4);
}

const digest = (s: string) => createHash("sha256").update(s.trim().toUpperCase()).digest();

/** Constant-time match against the configured codes. */
export function matchAccessCode(input: string, codes: AccessCode[]): AccessCode | undefined {
  const d = digest(input);
  let found: AccessCode | undefined;
  for (const c of codes) if (timingSafeEqual(d, digest(c.code))) found = c;
  return found;
}

/** ADMIN_EMAILS: comma-separated, case-insensitive. */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}
