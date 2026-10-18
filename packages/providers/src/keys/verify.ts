import type { ApiKeyProvider } from "@shortloop/contracts";
import { GEMINI_API } from "../llm/gemini";

export type KeyCheck = { ok: true; verified: boolean } | { ok: false; error: string };

/** A cheap, read-only request per provider that succeeds only with a valid key. Nothing billable. */
const PROBES: Partial<Record<ApiKeyProvider, (key: string) => [string, RequestInit]>> = {
  anthropic: (k) => [
    "https://api.anthropic.com/v1/models?limit=1",
    { headers: { "x-api-key": k, "anthropic-version": "2023-06-01" } },
  ],
  openai: (k) => ["https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${k}` } }],
  gemini: (k) => [`${GEMINI_API}/models?pageSize=1`, { headers: { "x-goog-api-key": k } }],
  elevenlabs: (k) => ["https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": k } }],
  pexels: (k) => [
    "https://api.pexels.com/v1/search?query=ocean&per_page=1",
    { headers: { authorization: k } },
  ],
  pixabay: (k) => [`https://pixabay.com/api/?key=${encodeURIComponent(k)}&q=ocean&per_page=3`, {}],
};

/**
 * Check a key before saving it. Providers without a free read-only endpoint (fal) are accepted unverified;
 * the first real job will surface a bad key.
 */
export async function verifyApiKey(
  provider: ApiKeyProvider,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  const probe = PROBES[provider];
  if (!probe) return { ok: true, verified: false };
  const [url, init] = probe(key);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, error: `Couldn't reach ${provider} to check the key. Try again in a moment.` };
  }
  if (res.ok) return { ok: true, verified: true };
  if (res.status === 401 || res.status === 403 || res.status === 400) {
    return {
      ok: false,
      error: `${provider} rejected this key (${res.status}). Check you copied the whole key.`,
    };
  }
  if (res.status === 429) return { ok: true, verified: false }; // valid but rate-limited
  return { ok: false, error: `${provider} returned ${res.status} while checking the key.` };
}

/** Offline stand-in used with SHORTLOOP_FAKE_PROVIDERS: keys starting `test-` pass, anything else fails. */
export async function fakeVerifyApiKey(provider: ApiKeyProvider, key: string): Promise<KeyCheck> {
  return key.startsWith("test-")
    ? { ok: true, verified: true }
    : { ok: false, error: `${provider} rejected this key (401).` };
}
