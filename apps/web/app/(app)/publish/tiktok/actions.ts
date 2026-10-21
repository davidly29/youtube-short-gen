"use server";
import { revalidatePath } from "next/cache";
import { ZodError, type z } from "zod";
import { requireUser } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import { disconnectTikTok, postToTikTok, type TikTokForm } from "./service";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function postToTikTokAction(projectId: string, form: z.input<typeof TikTokForm>) {
  const r = await wrap((uid) => postToTikTok(uid, projectId, form));
  revalidatePath("/publish/tiktok");
  return r;
}

export async function disconnectTikTokAction(channelId: string) {
  const r = await wrap((uid) => disconnectTikTok(uid, channelId));
  revalidatePath("/publish/tiktok");
  revalidatePath("/channels");
  return r;
}
