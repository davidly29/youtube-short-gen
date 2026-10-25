import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WEBHOOK_TOLERANCE_SECONDS } from "@shortloop/contracts";

/** One HTTP POST to a customer's webhook URL (E12-01). */
export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** `status` when the receiver answered; `error` when it couldn't be reached (DNS, TLS, timeout, blocked host). */
export interface WebhookResponse {
  status?: number;
  error?: string;
}

export interface WebhookSender {
  send(req: WebhookRequest): Promise<WebhookResponse>;
}

export const SIGNATURE_HEADER = "shortloop-signature";

/** A new signing secret, shown to the user once. */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

const hmac = (secret: string, timestamp: number, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** `ShortLoop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (Stripe-style). */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

/** What receivers do (and what the docs show): check the HMAC in constant time and reject stale timestamps. */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(hmac(secret, t, body), "hex");
  const got = Buffer.from(v1, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (v4 and v6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

type Resolve = (host: string) => Promise<string[]>;
const resolveAll: Resolve = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * Real delivery over HTTPS. The host is resolved first and refused when any address is private (SSRF guard);
 * redirects are not followed; each attempt times out after 10 s; the response body is never read.
 */
export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly opts: { timeoutMs?: number; resolve?: Resolve; fetch?: typeof fetch } = {}) {}

  async send(req: WebhookRequest): Promise<WebhookResponse> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return { error: "Invalid URL" };
    }
    if (url.protocol !== "https:") return { error: "Webhook URLs must use https://" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await (this.opts.resolve ?? resolveAll)(host);
    } catch {
      return { error: `Couldn't resolve ${host}` };
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress))
      return { error: "Webhook host resolves to a private address" };
    try {
      const res = await (this.opts.fetch ?? fetch)(url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      await res.body?.cancel().catch(() => undefined);
      return { status: res.status };
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { error: timeout ? "Timed out after 10 s" : "Couldn't connect" };
    }
  }
}

/** URLs containing this answer 500 in fake mode, so e2e can exercise retries. */
export const FAKE_WEBHOOK_FAIL_MARKER = "fail";

/** Records every request; answers 200, or 500 for URLs containing `fail`. No network. */
export class FakeWebhookSender implements WebhookSender {
  readonly sent: WebhookRequest[] = [];
  async send(req: WebhookRequest): Promise<WebhookResponse> {
    this.sent.push(req);
    return { status: req.url.includes(FAKE_WEBHOOK_FAIL_MARKER) ? 500 : 200 };
  }
}
