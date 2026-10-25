"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import { createApiKey, revokeApiKey } from "../../../../src/server/api/keys";
import { createWebhook, deleteWebhook } from "../../../../src/server/api/webhooks";

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function wrap<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const value = await fn(user.id);
    revalidatePath("/settings/developer");
    return { ok: true, value };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** The plaintext key comes back once, for the user to copy. */
export async function createApiKeyAction(name: string) {
  return wrap(async (uid) => (await createApiKey(uid, { name })).key);
}

export async function revokeApiKeyAction(id: string) {
  return wrap((uid) => revokeApiKey(uid, id));
}

/** The signing secret comes back once. */
export async function createWebhookAction(url: string, events: string[]) {
  return wrap(async (uid) => (await createWebhook(uid, { url, events })).secret);
}

export async function deleteWebhookAction(id: string) {
  return wrap((uid) => deleteWebhook(uid, id));
}
