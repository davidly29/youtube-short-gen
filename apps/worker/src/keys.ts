import { eq, schema, type Db } from "@shortloop/db";
import { keyAad, providersFromKeys, type SecretBox, type UserKey } from "@shortloop/providers";
import type { WorkerProviders } from "./worker";

/** Decrypt a user's saved keys. Plaintext lives only in memory for the current job or request. */
export async function loadUserKeys(db: Db, box: SecretBox, ownerId: string): Promise<UserKey[]> {
  const rows = await db.select().from(schema.userApiKeys).where(eq(schema.userApiKeys.ownerId, ownerId));
  const keys: UserKey[] = [];
  for (const r of rows) {
    try {
      keys.push({
        provider: r.provider,
        key: box.open(r.secret, keyAad(ownerId, r.provider)),
        model: r.model ?? undefined,
        imageModel: r.imageModel ?? undefined,
        updatedAt: new Date(r.updatedAt).toISOString(),
      });
    } catch {
      // Unreadable (e.g. the master key was rotated): treat as missing; the user re-enters it in Settings.
    }
  }
  return keys;
}

/** Resolver for createWorker: the providers the job owner's own keys unlock. */
export function userKeyResolver(
  db: Db,
  box: SecretBox,
  opts: { fake?: boolean; fetch?: typeof fetch } = {},
): (ownerId: string) => Promise<WorkerProviders> {
  return async (ownerId) => {
    const set = providersFromKeys(await loadUserKeys(db, box, ownerId), opts);
    return { llm: set.llm, image: set.image, tts: set.tts, stock: set.stock.length ? set.stock : undefined };
  };
}
