import "server-only";
import { randomUUID } from "node:crypto";
import { ApiKeyInfo, ApiKeyProvider, ProviderRouting, SaveApiKey } from "@shortloop/contracts";
import { managedAllowance } from "@shortloop/pipeline";
import { loadRouting } from "@shortloop/worker";
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
      lastOkAt: r.lastOkAt ? new Date(r.lastOkAt).toISOString() : undefined,
      lastError: r.lastError ?? undefined,
      unavailable: r.unavailable ?? [],
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
    // A new or re-saved key starts with a clean bill of health.
    lastError: null,
    unavailable: [],
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

/** The user's routing choices: which provider does each job (ADR 0007). */
export async function getRouting(userId: string): Promise<ProviderRouting> {
  const { db } = await runtime();
  return loadRouting(db, userId);
}

export async function saveRouting(userId: string, input: unknown): Promise<ProviderRouting> {
  const parsed = ProviderRouting.safeParse(input);
  if (!parsed.success) throw new UserError("That provider can't do this job.");
  const r = parsed.data;
  const { db } = await runtime();
  const values = {
    llm: r.llm ?? null,
    image: r.image ?? null,
    tts: r.tts ?? null,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(schema.providerRouting)
    .values({ ownerId: userId, ...values })
    .onConflictDoUpdate({ target: schema.providerRouting.ownerId, set: values });
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: "provider_routing.saved",
    subjectId: userId,
    data: { llm: r.llm ?? null, image: r.image ?? null, tts: r.tts ?? null },
  });
  return r;
}

/** Re-enable a job a key was marked unable to do (e.g. after turning on billing), and clear its last error. */
export async function resetKeyHealth(userId: string, provider: unknown): Promise<void> {
  const p = ApiKeyProvider.parse(provider);
  const { db } = await runtime();
  await db
    .update(schema.userApiKeys)
    .set({ unavailable: [], lastError: null })
    .where(and(eq(schema.userApiKeys.ownerId, userId), eq(schema.userApiKeys.provider, p)));
}

/** ShortLoop AI on the user's plan: whether they have it, and this month's spend against their limit. */
export async function shortloopAllowance(userId: string) {
  const { db } = await runtime();
  return managedAllowance(db, userId);
}
