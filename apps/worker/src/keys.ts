import { ProviderRouting, type ApiKeyProvider, type KeyUnavailable } from "@shortloop/contracts";
import { and, eq, schema, type Db } from "@shortloop/db";
import {
  keyAad,
  providersFromKeys,
  type HealthyKey,
  type ProviderEvent,
  type SecretBox,
} from "@shortloop/providers";
import type { WorkerProviders } from "./worker";

/** Decrypt a user's saved keys (with their health). Plaintext lives only in memory for the current job or request. */
export async function loadUserKeys(db: Db, box: SecretBox, ownerId: string): Promise<HealthyKey[]> {
  const rows = await db.select().from(schema.userApiKeys).where(eq(schema.userApiKeys.ownerId, ownerId));
  const keys: HealthyKey[] = [];
  for (const r of rows) {
    try {
      keys.push({
        provider: r.provider,
        key: box.open(r.secret, keyAad(ownerId, r.provider)),
        model: r.model ?? undefined,
        imageModel: r.imageModel ?? undefined,
        updatedAt: new Date(r.updatedAt).toISOString(),
        unavailable: r.unavailable ?? [],
      });
    } catch {
      // Unreadable (e.g. the master key was rotated): treat as missing; the user re-enters it in Settings.
    }
  }
  return keys;
}

/** The user's routing choices (Settings → API keys); invalid stored values are ignored. */
export async function loadRouting(db: Db, ownerId: string): Promise<ProviderRouting> {
  const row = await db.query.providerRouting.findFirst({
    where: eq(schema.providerRouting.ownerId, ownerId),
  });
  if (!row) return {};
  const parsed = ProviderRouting.safeParse({
    llm: row.llm ?? undefined,
    image: row.image ?? undefined,
    tts: row.tts ?? undefined,
  });
  return parsed.success ? parsed.data : {};
}

const KEY_PROVIDERS = new Set<string>([
  "anthropic",
  "openai",
  "gemini",
  "elevenlabs",
  "fal",
  "pexels",
  "pixabay",
]);

/**
 * Remember how a user's key did (ADR 0007): last success, last error, and jobs it can't do at all (e.g. Gemini
 * images on the free tier), which routing then skips until the user re-enables them in Settings.
 */
export async function recordKeyHealth(db: Db, ownerId: string, e: ProviderEvent): Promise<void> {
  if (e.source !== "own" || !KEY_PROVIDERS.has(e.provider)) return;
  const where = and(
    eq(schema.userApiKeys.ownerId, ownerId),
    eq(schema.userApiKeys.provider, e.provider as ApiKeyProvider),
  );
  const at = new Date().toISOString();
  if (e.ok) {
    await db.update(schema.userApiKeys).set({ lastOkAt: at }).where(where);
    return;
  }
  if (!e.error) return;
  const row = await db.query.userApiKeys.findFirst({ where });
  if (!row) return;
  const unavailable: KeyUnavailable[] = [...(row.unavailable ?? [])];
  if (e.error.noAccess && !unavailable.some((u) => u.capability === e.capability))
    unavailable.push({ capability: e.capability, reason: e.error.message.slice(0, 300), at });
  await db
    .update(schema.userApiKeys)
    .set({
      lastError: { kind: e.error.kind, capability: e.capability, message: e.error.message.slice(0, 500), at },
      unavailable,
    })
    .where(where);
}

/** Legacy resolver for createWorker: the providers the job owner's own keys unlock (defaults routing). */
export function userKeyResolver(
  db: Db,
  box: SecretBox,
  opts: { fake?: boolean; fetch?: typeof fetch } = {},
): (ownerId: string) => Promise<WorkerProviders> {
  return async (ownerId) => {
    const set = providersFromKeys(await loadUserKeys(db, box, ownerId), {
      ...opts,
      routing: await loadRouting(db, ownerId),
    });
    return { llm: set.llm, image: set.image, tts: set.tts, stock: set.stock.length ? set.stock : undefined };
  };
}
