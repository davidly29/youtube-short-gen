import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  API_KEY_DISPLAY_CHARS,
  API_KEY_PREFIX,
  CreatePublicApiKey,
  MAX_API_KEYS,
  PublicApiKey,
} from "@shortloop/contracts";
import { and, desc, eq, isNull, schema } from "@shortloop/db";
import { UserError } from "../errors";
import { runtime } from "../runtime";

/** Public REST API keys (E12-01). The plaintext is returned once at creation; only its SHA-256 is stored. */

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const iso = (s: string | null) => (s ? new Date(s).toISOString() : undefined);

type Row = typeof schema.publicApiKeys.$inferSelect;
const toPublic = (r: Row): PublicApiKey =>
  PublicApiKey.parse({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    created_at: iso(r.createdAt),
    last_used_at: iso(r.lastUsedAt),
  });

export async function listApiKeys(userId: string): Promise<PublicApiKey[]> {
  const { db } = await runtime();
  const rows = await db
    .select()
    .from(schema.publicApiKeys)
    .where(and(eq(schema.publicApiKeys.ownerId, userId), isNull(schema.publicApiKeys.revokedAt)))
    .orderBy(desc(schema.publicApiKeys.createdAt));
  return rows.map(toPublic);
}

export async function createApiKey(
  userId: string,
  input: unknown,
): Promise<{ key: string; info: PublicApiKey }> {
  const { name } = CreatePublicApiKey.parse(input);
  const { db } = await runtime();
  if ((await listApiKeys(userId)).length >= MAX_API_KEYS)
    throw new UserError(`You can have up to ${MAX_API_KEYS} API keys. Revoke one first.`);
  const key = `${API_KEY_PREFIX}${randomBytes(30).toString("base64url")}`;
  const [row] = await db
    .insert(schema.publicApiKeys)
    .values({
      id: `apk_${randomUUID()}`,
      ownerId: userId,
      name,
      prefix: key.slice(0, API_KEY_DISPLAY_CHARS),
      hash: hashKey(key),
    })
    .returning();
  if (!row) throw new Error("API key insert returned nothing");
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "public_api_key.created",
    subjectId: row.id,
    data: { name, prefix: row.prefix },
  });
  return { key, info: toPublic(row) };
}

export async function revokeApiKey(userId: string, keyId: unknown): Promise<void> {
  if (typeof keyId !== "string") throw new UserError("Unknown API key.");
  const { db } = await runtime();
  const [row] = await db
    .update(schema.publicApiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.publicApiKeys.id, keyId),
        eq(schema.publicApiKeys.ownerId, userId),
        isNull(schema.publicApiKeys.revokedAt),
      ),
    )
    .returning();
  if (!row) throw new UserError("Unknown API key.");
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "public_api_key.revoked",
    subjectId: row.id,
    data: { name: row.name, prefix: row.prefix },
  });
}

/** The key's owner, or undefined for a missing, malformed, unknown or revoked key. Records last use (≤ 1/min). */
export async function authenticateApiKey(
  authorization: string | null,
): Promise<{ keyId: string; userId: string } | undefined> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  const token = m?.[1];
  if (!token?.startsWith(API_KEY_PREFIX) || token.length > 200) return undefined;
  const { db } = await runtime();
  const row = await db.query.publicApiKeys.findFirst({
    where: eq(schema.publicApiKeys.hash, hashKey(token)),
  });
  if (!row || row.revokedAt) return undefined;
  const now = Date.now();
  if (!row.lastUsedAt || now - new Date(row.lastUsedAt).getTime() > 60_000) {
    await db
      .update(schema.publicApiKeys)
      .set({ lastUsedAt: new Date(now).toISOString() })
      .where(eq(schema.publicApiKeys.id, row.id));
  }
  return { keyId: row.id, userId: row.ownerId };
}
