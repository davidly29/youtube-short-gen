"use server";
import { revalidatePath } from "next/cache";
import { redeemAccessCode } from "../../src/server/access";
import { requireUser } from "../../src/server/auth";
import { chooseActiveChannels, disconnect } from "../../src/server/channels";
import { deleteKey, resetKeyHealth, saveKey, saveRouting } from "../../src/server/keys";
import { publishShort, type PublishForm } from "../../src/server/publishing";
import {
  alternatives,
  approve,
  createProject,
  projectView,
  requestAiScript,
  saveScript,
  startProduction,
  swapVisual,
  updateCaptions,
  UserError,
  type NewProject,
  type ProductionSettings,
  type ScriptDraft,
} from "../../src/server/projects";
import { ProviderError, type StockResult } from "@shortloop/providers";
import { ZodError, type z } from "zod";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    const message =
      e instanceof UserError || e instanceof ProviderError
        ? e.message
        : e instanceof ZodError
          ? (e.issues[0]?.message ?? "Please check the highlighted fields.")
          : "Something went wrong. Please try again.";
    // Validation errors are the user's to fix; don't log them (they may echo what was typed, e.g. a key).
    if (!(e instanceof UserError) && !(e instanceof ZodError) && !(e instanceof ProviderError))
      console.error(e);
    return { ok: false, error: message };
  }
}

export async function createProjectAction(input: z.infer<typeof NewProject>) {
  return wrap((uid) => createProject(uid, input));
}

export async function aiScriptAction(projectId: string) {
  return wrap((uid) => requestAiScript(uid, projectId));
}

export async function saveScriptAction(
  projectId: string,
  draft: z.infer<typeof ScriptDraft>,
  overrideVariation = false,
) {
  const r = await wrap((uid) => saveScript(uid, projectId, draft, overrideVariation));
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function produceAction(projectId: string, settings: z.infer<typeof ProductionSettings>) {
  const r = await wrap((uid) => startProduction(uid, projectId, settings));
  revalidatePath("/", "layout");
  return r;
}

export async function captionsAction(projectId: string, edits: { index: number; text: string }[]) {
  return wrap((uid) => updateCaptions(uid, projectId, edits));
}

export async function alternativesAction(projectId: string, beatIndex: number) {
  return wrap((uid) => alternatives(uid, projectId, beatIndex));
}

export async function swapAction(
  projectId: string,
  beatIndex: number,
  choice: { kind: "stock"; result: StockResult } | { kind: "ai"; prompt?: string },
) {
  return wrap((uid) => swapVisual(uid, projectId, beatIndex, choice));
}

export async function approveAction(projectId: string) {
  const r = await wrap((uid) => approve(uid, projectId));
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function saveKeyAction(input: {
  provider: string;
  key: string;
  model?: string;
  imageModel?: string;
}) {
  const r = await wrap((uid) => saveKey(uid, input));
  revalidatePath("/", "layout");
  return r;
}

export async function deleteKeyAction(provider: string) {
  const r = await wrap((uid) => deleteKey(uid, provider));
  revalidatePath("/", "layout");
  return r;
}

export async function saveRoutingAction(input: { llm?: string; image?: string; tts?: string }) {
  const r = await wrap((uid) => saveRouting(uid, input));
  revalidatePath("/", "layout");
  return r;
}

export async function resetKeyAction(provider: string) {
  const r = await wrap((uid) => resetKeyHealth(uid, provider));
  revalidatePath("/settings/keys");
  return r;
}

export async function disconnectAction(channelId: string) {
  const r = await wrap((uid) => disconnect(uid, channelId));
  revalidatePath("/channels");
  return r;
}

export async function chooseActiveChannelsAction(channelIds: string[]) {
  const r = await wrap((uid) => chooseActiveChannels(uid, channelIds));
  revalidatePath("/channels");
  return r;
}

export async function publishAction(projectId: string, form: z.input<typeof PublishForm>) {
  const r = await wrap(async (uid) => {
    const view = await projectView(uid, projectId);
    return publishShort(uid, projectId, form, view.aiDisclosureRequired);
  });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function redeemCodeAction(code: string) {
  const r = await wrap((uid) => redeemAccessCode(uid, code));
  revalidatePath("/", "layout");
  return r;
}
