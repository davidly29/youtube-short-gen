"use server";
import { revalidatePath } from "next/cache";
import { ZodError, type z } from "zod";
import { requireUser } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import {
  buildChannelVoice,
  saveChannelVoice,
  setChannelVoiceEnabled,
  type VoiceForm,
} from "../../../../src/server/style";

type Result = { ok: true } | { ok: false; error: string };

async function wrap(fn: (userId: string) => Promise<unknown>): Promise<Result> {
  const user = await requireUser();
  try {
    await fn(user.id);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  revalidatePath("/settings/voice");
  revalidatePath("/new");
  return { ok: true };
}

/** Learn (or relearn) a channel's voice from the creator's own published videos (E4-03). */
export async function buildVoiceAction(channelId: string) {
  return wrap((uid) => buildChannelVoice(uid, channelId));
}

export async function saveVoiceAction(channelId: string, form: z.input<typeof VoiceForm>) {
  return wrap((uid) => saveChannelVoice(uid, channelId, form));
}

export async function toggleVoiceAction(channelId: string, enabled: boolean) {
  return wrap((uid) => setChannelVoiceEnabled(uid, channelId, enabled));
}
