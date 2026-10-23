import { z } from "zod";

/**
 * Public REST API (E12-01): API keys, webhooks and the error envelope. Endpoint request/response bodies reuse the
 * MCP tool schemas (`@shortloop/mcp`) so the two surfaces can't drift.
 */

/** Plaintext keys look like `sl_<40 base64url chars>`; only a SHA-256 hash and the first 11 characters are stored. */
export const API_KEY_PREFIX = "sl_";
export const API_KEY_DISPLAY_CHARS = 11;
/** Keys a user can have at once (revoked keys don't count). */
export const MAX_API_KEYS = 10;
/** Requests per key per minute unless `API_RATE_LIMIT_PER_MINUTE` says otherwise. */
export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 60;

export const PublicApiKey = z.object({
  id: z.string(),
  name: z.string(),
  /** e.g. `sl_Ab3dE5gH` — enough to recognise the key, never enough to use it. */
  prefix: z.string(),
  created_at: z.string(),
  last_used_at: z.string().optional(),
});
export type PublicApiKey = z.infer<typeof PublicApiKey>;

export const CreatePublicApiKey = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(60),
});

export const WEBHOOK_EVENTS = ["job.succeeded", "job.failed", "publish.completed"] as const;
export const WebhookEventType = z.enum(WEBHOOK_EVENTS);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/** Webhooks a user can register at once. */
export const MAX_WEBHOOKS = 5;
/** Delivery attempts before a delivery is marked failed (first try + retries). */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Wait before retry n (1-based): 1 min, 5 min, 30 min, 2 h, 6 h. */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const;
/** Signatures older than this should be rejected by receivers (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

function parseUrl(u: string): URL | undefined {
  try {
    return new URL(u);
  } catch {
    return undefined;
  }
}

/** Receivers must be public HTTPS URLs (no credentials, no private or loopback hosts). */
export const WebhookUrl = z
  .string()
  .trim()
  .max(2000)
  .superRefine((u, ctx) => {
    const url = parseUrl(u);
    const problem = !url
      ? "Enter a full URL, e.g. https://example.com/shortloop"
      : url.protocol !== "https:"
        ? "Webhook URLs must use https://"
        : url.username || url.password
          ? "Don't put credentials in the URL."
          : PRIVATE_HOST.test(url.hostname)
            ? "Webhook URLs must point at a public host."
            : undefined;
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const CreateWebhook = z.object({
  url: WebhookUrl,
  events: z
    .array(WebhookEventType)
    .min(1)
    .max(WEBHOOK_EVENTS.length)
    .default([...WEBHOOK_EVENTS]),
});

export const Webhook = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(WebhookEventType),
  created_at: z.string(),
});
export type Webhook = z.infer<typeof Webhook>;

export const WebhookCreated = Webhook.extend({
  secret: z
    .string()
    .describe("Signing secret (whsec_...). Shown once: store it to verify ShortLoop-Signature."),
});

export const DeliveryStatus = z.enum(["pending", "delivered", "failed"]);
export const WebhookDelivery = z.object({
  id: z.string(),
  event: WebhookEventType,
  status: DeliveryStatus,
  attempts: z.number().int(),
  response_status: z.number().int().optional(),
  error: z.string().optional(),
  created_at: z.string(),
  delivered_at: z.string().optional(),
  next_attempt_at: z.string().optional(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

/** What a production or publish looked like when the event fired. Fetch GET /jobs/{job_id} for signed links. */
export const WebhookEventData = z.object({
  job_id: z.string(),
  kind: z.enum(["production", "publish"]),
  project_id: z.string().optional(),
  status: z.string(),
  error: z.string().optional(),
  publish_id: z.string().optional(),
  platform: z.string().optional(),
  url: z.string().optional(),
});
export type WebhookEventData = z.infer<typeof WebhookEventData>;

/** The JSON body POSTed to a webhook URL. `id` is stable across retries of the same event. */
export const WebhookPayload = z.object({
  id: z.string(),
  type: WebhookEventType,
  created_at: z.string(),
  data: WebhookEventData,
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;

export const ApiErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid_request",
  "rate_limited",
  "method_not_allowed",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
