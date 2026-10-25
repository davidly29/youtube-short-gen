import type { WebhookPayload } from "./generated";

export const SIGNATURE_HEADER = "ShortLoop-Signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a `ShortLoop-Signature: t=<unix>,v1=<hex>` header against the raw request body and your webhook secret.
 * Pass the body exactly as received (before JSON parsing). Signatures older than 5 minutes are rejected.
 */
export async function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = new Map<string, string[]>();
  for (const piece of signatureHeader.split(",")) {
    const i = piece.indexOf("=");
    if (i < 1) continue;
    const k = piece.slice(0, i).trim();
    parts.set(k, [...(parts.get(k) ?? []), piece.slice(i + 1).trim()]);
  }
  const t = Number(parts.get("t")?.[0]);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || Math.abs(now - t) > (opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) {
    return false;
  }
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return (parts.get("v1") ?? []).some((v) => constantTimeEqual(v.toLowerCase(), expected));
}

/** Verify, then parse. Throws if the signature is missing, wrong or stale. */
export async function parseWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): Promise<WebhookPayload> {
  if (!(await verifyWebhook(rawBody, signatureHeader, secret, opts))) {
    throw new Error("ShortLoop webhook: bad or stale signature");
  }
  return JSON.parse(rawBody) as WebhookPayload;
}
