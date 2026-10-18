import "server-only";
import { randomUUID } from "node:crypto";
import { ApiKeyInfo, ApiKeyProvider, SaveApiKey } from "@shortloop/contracts";
import { and, eq, schema } from "@shortloop/db";
import { fakeVerifyApiKey, keyAad, last4, verifyApiKey } from "@shortloop/providers";
import { UserError } from "./errors";
import { runtime } from "./runtime";

/** The user's saved keys, masked. The secret never leaves the server. */
export async function listKeys(userId: string): Promise<ApiKeyInfo[]> {
  const { db } = await runtime();
  const rows = await db.select().from(schema.userApiKeys).where(eq(schema.userApiKeys.ownerId, userId));
  return rows.map((r) =>
    ApiKeyInfo.parse({
      provider: r.provider,
      last4: r.last4,
      model: r.model ?? undefined,
      imageModel: r.imageModel ?? undefined,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt).toISOString() : undefined,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }),
  );
}

/** Check the key with the provider, then store it encrypted (replacing any previous key for that provider). */
export async function saveKey(userId: string, input: unknown): Promise<ApiKeyInfo> {
  const data = SaveApiKey.parse(input);
  const rt = await runtime();
  const check = rt.fake
    ? await fakeVerifyApiKey(data.provider, data.key)
    : await verifyApiKey(data.provider, data.key);
  if (!check.ok) throw new UserError(check.error);
  const now = new Date().toISOString();
  const values = {
    secret: rt.box.seal(data.key, keyAad(userId, data.provider)),
    last4: last4(data.key),
    model: data.model || null,
    imageModel: data.imageModel || null,
    verifiedAt: check.verified ? now : null,
    updatedAt: now,
  };
  await rt.db
    .insert(schema.userApiKeys)
    .values({ id: `key_${randomUUID()}`, ownerId: userId, provider: data.provider, ...values })
    .onConflictDoUpdate({ target: [schema.userApiKeys.ownerId, schema.userApiKeys.provider], set: values });
  await rt.db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "api_key.saved",
    subjectId: data.provider,
    data: { provider: data.provider, last4: values.last4, verified: check.verified },
  });
  const saved = (await listKeys(userId)).find((k) => k.provider === data.provider);
  if (!saved) throw new Error("key not saved");
  return saved;
}

export async function deleteKey(userId: string, provider: unknown): Promise<void> {
  const p = ApiKeyProvider.parse(provider);
  const { db } = await runtime();
  await db
    .delete(schema.userApiKeys)
    .where(and(eq(schema.userApiKeys.ownerId, userId), eq(schema.userApiKeys.provider, p)));
  await db
    .insert(schema.auditEvents)
    .values({ ownerId: userId, type: "api_key.deleted", subjectId: p, data: { provider: p } });
}
