import "server-only";
import { randomUUID } from "node:crypto";
import { Asset, CaptionStyleId, Script, Timeline } from "@shortloop/contracts";
import { balance, desc, eq, inArray, schema, toTimeline, and, toAsset as dbToAsset } from "@shortloop/db";
import {
  assertPublishable,
  buildRightsManifest,
  checkVariation,
  NotPublishableError,
  policyCheckScript,
  recordAudit,
  recordVariationOverride,
  scriptWordCount,
  targetWords,
  WORDS_PER_SECOND,
  requiresAiDisclosure,
  type RightsManifest,
} from "@shortloop/pipeline";
import { generateImageAsset, importStock, type StockResult } from "@shortloop/providers";
import { addNotices, styleForScript } from "@shortloop/worker";
import { z } from "zod";
import { accessOf } from "./access";
import { listChannels } from "./channels";
import { ownedUploads } from "./library";
import { listPublishes } from "./publishing";
import { runtime } from "./runtime";

import { UserError } from "./errors";
export { UserError };

const toAsset = (r: typeof schema.assets.$inferSelect): Asset => Asset.parse(dbToAsset(r));

async function ownProject(userId: string, projectId: string) {
  const { db } = await runtime();
  const p = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)),
  });
  if (!p) throw new UserError("Project not found");
  return p;
}

export async function listProjects(userId: string) {
  const { db } = await runtime();
  return db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, userId))
    .orderBy(desc(schema.projects.createdAt));
}

export async function credits(userId: string) {
  const { db } = await runtime();
  const access = await accessOf(userId);
  return {
    shorts: await balance(db, userId, "short"),
    aiVideo: await balance(db, userId, "ai_video_credit"),
    /** Admins and beta access-code holders: no credits needed. */
    unlimited: access.unlimited,
    admin: access.admin,
  };
}

/** What this user can do right now: their own keys first, then the platform defaults. */
export async function capabilities(userId: string) {
  const rt = await runtime();
  const p = await rt.resolve({ ownerId: userId });
  const tts = p.tts ?? rt.tts;
  return {
    aiScripts: Boolean(p.llm),
    llmProvider: p.llm?.provider,
    stock: (p.stock ?? rt.stock).map((s) => s.provider),
    image: (p.image ?? rt.image).provider,
    voices: tts.voices(),
    /** Which provider each job uses (own key, "shortloop" or "free"). ADR 0007. */
    route: p.route,
    mode: rt.mode,
  };
}

export const NewProject = z.object({
  topic: z.string().trim().min(3, "Tell us what the Short is about").max(300),
  angle: z.string().trim().max(300).optional(),
  targetSeconds: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  tone: z.string().trim().min(2).max(40),
  /** The daily-brief topic this Short was made from (E3-03b); keeps it out of briefs for 14 days. */
  topicId: z
    .string()
    .regex(/^top_[A-Za-z0-9_]{1,60}$/)
    .optional(),
  /** Write in this connected channel's voice (E4-03). */
  styleChannelId: z.string().max(80).optional(),
});

export async function createProject(userId: string, input: z.infer<typeof NewProject>) {
  const data = NewProject.parse(input);
  const { db } = await runtime();
  const id = `prj_${randomUUID()}`;
  await db.insert(schema.projects).values({
    id,
    ownerId: userId,
    title: data.topic.slice(0, 80),
    topic: data.topic,
    topicId: data.topicId,
    settings: {
      targetSeconds: data.targetSeconds,
      tone: data.tone,
      angle: data.angle,
      language: "en",
      styleChannelId: data.styleChannelId,
    },
  });
  return id;
}

/** Queue an AI script for the project's topic. Returns the job id to poll. */
export async function requestAiScript(
  userId: string,
  projectId: string,
  /** Start production as soon as the script is written (MCP create_short: topic to video in one call). */
  produce?: { voiceId: string; captionStyle: z.infer<typeof CaptionStyleId>; imageStyle?: string },
) {
  const rt = await runtime();
  if (!(await rt.providersFor(userId)).llm)
    throw new UserError(
      "AI scripts use your own AI key. Add an Anthropic, OpenAI or Gemini key in Settings → API keys, or write the script yourself.",
    );
  const p = await ownProject(userId, projectId);
  // Only an enabled profile on a channel this user still has; otherwise the script is written without one.
  const styleProfile = await styleForScript(rt.db, userId, p.settings.styleChannelId);
  const job = await rt.jobs.enqueue(
    "script",
    {
      projectId,
      topic: p.topic ?? p.title,
      angle: p.settings.angle,
      targetSeconds: p.settings.targetSeconds ?? 45,
      tone: p.settings.tone ?? "curious",
      language: p.settings.language ?? "en",
      styleProfile,
      produce,
    },
    { idempotencyKey: `script:${projectId}:${Date.now()}`, ownerId: userId },
  );
  await rt.db
    .update(schema.projects)
    .set({ status: "scripting", lastJobId: job.id })
    .where(eq(schema.projects.id, projectId));
  return job.id;
}

export const ScriptDraft = z.object({
  title: z.string().trim().min(1).max(100),
  beats: z
    .array(
      z.object({
        text: z.string().trim().min(1, "Every beat needs narration"),
        visualQuery: z.string().trim().min(1, "Describe what to show"),
      }),
    )
    .min(2, "Add at least two beats")
    .max(12),
  cta: z.string().trim().max(200),
});

export interface SaveScriptResult {
  ok: boolean;
  scriptId?: string;
  problems: string[];
  /** Near-duplicate warnings that the user may override explicitly. */
  variation?: string[];
}

/** Validate, policy-check and variation-check a (possibly hand-edited) script, then save it as the project's script. */
export async function saveScript(
  userId: string,
  projectId: string,
  draft: z.infer<typeof ScriptDraft>,
  overrideVariation = false,
): Promise<SaveScriptResult> {
  const d = ScriptDraft.parse(draft);
  const rt = await runtime();
  await ownProject(userId, projectId);
  const hook = (d.beats[0]?.text.match(/^[^.!?]*[.!?]?/)?.[0] ?? d.beats[0]?.text ?? "").trim();
  const script = Script.parse({
    id: `scr_${randomUUID()}`,
    projectId,
    title: d.title,
    hook,
    beats: d.beats.map((b, i) => ({
      id: `b${i + 1}`,
      text: b.text,
      visualQuery: b.visualQuery,
      estDurationMs: Math.round(((b.text.match(/\S+/g)?.length ?? 0) / WORDS_PER_SECOND) * 1000),
    })),
    cta: d.cta,
    language: "en",
    wordCount: scriptWordCount(d),
  });
  const policy = policyCheckScript(script);
  if (!policy.allow) return { ok: false, problems: policy.reasons.map((r) => r.message) };
  const variation = await checkVariation(rt.db, userId, script);
  if (!variation.ok && !overrideVariation) return { ok: false, problems: [], variation: variation.reasons };
  if (!variation.ok && overrideVariation) await recordVariationOverride(rt.db, userId, script.id, variation);
  await rt.db.insert(schema.scripts).values({
    id: script.id,
    projectId,
    title: script.title,
    hook: script.hook,
    beats: script.beats,
    cta: script.cta,
    language: script.language,
    wordCount: script.wordCount,
  });
  await rt.db
    .update(schema.projects)
    .set({
      scriptId: script.id,
      title: script.title,
      status: "script_ready",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.projects.id, projectId));
  return { ok: true, scriptId: script.id, problems: [] };
}

export const ProductionSettings = z.object({
  voiceId: z.string().min(1),
  captionStyle: CaptionStyleId,
  imageStyle: z.string().max(40).optional(),
  /** The user's own uploads to use on beats they match (E5-02: library before stock before AI). */
  libraryAssetIds: z.array(z.string().max(100)).max(30).optional(),
});

/** "Make my Short": one credit, then voice -> visuals -> render run in the background. */
export async function startProduction(
  userId: string,
  projectId: string,
  settings: z.infer<typeof ProductionSettings>,
) {
  const s = ProductionSettings.parse(settings);
  const rt = await runtime();
  const p = await ownProject(userId, projectId);
  if (!p.scriptId) throw new UserError("Save a script first.");
  if (!(await accessOf(userId)).unlimited && (await balance(rt.db, userId, "short")) < 1) {
    throw new UserError("You're out of Short credits.");
  }
  const libraryAssetIds = await ownedUploads(userId, s.libraryAssetIds ?? []);
  await rt.db
    .update(schema.projects)
    .set({
      settings: { ...p.settings, ...s },
      status: "producing",
      error: null,
      renderAssetId: null,
      approvedAt: null,
    })
    .where(eq(schema.projects.id, projectId));
  const job = await rt.jobs.enqueue(
    "voice",
    {
      scriptId: p.scriptId,
      voiceId: s.voiceId,
      chain: { projectId, captionStyle: s.captionStyle, imageStyle: s.imageStyle, libraryAssetIds },
    },
    { idempotencyKey: `produce:${projectId}:${Date.now()}`, ownerId: userId },
  );
  await rt.db.update(schema.projects).set({ lastJobId: job.id }).where(eq(schema.projects.id, projectId));
  return job.id;
}

const STAGES = ["script", "voice", "visuals", "render"] as const;

/** Everything the project page needs, with short-lived signed URLs for media. */
export async function projectView(userId: string, projectId: string) {
  const rt = await runtime();
  const p = await ownProject(userId, projectId);
  const script = p.scriptId
    ? await rt.db.query.scripts.findFirst({ where: eq(schema.scripts.id, p.scriptId) })
    : undefined;
  const job = p.lastJobId ? await rt.jobs.get(p.lastJobId) : undefined;
  const timelineRow = p.timelineId
    ? await rt.db.query.timelines.findFirst({ where: eq(schema.timelines.id, p.timelineId) })
    : undefined;
  const timeline = timelineRow ? Timeline.parse(toTimeline(timelineRow)) : undefined;
  let manifest: RightsManifest | undefined;
  let publishable: { ok: boolean; problems: string[] } = { ok: false, problems: ["Not rendered yet"] };
  let beatsVisuals: { beatId: string; text: string; assetId: string; source: string; previewUrl: string }[] =
    [];
  if (timeline) {
    const ids = [...new Set([...timeline.video, ...timeline.audio].map((c) => c.assetId))];
    const assets = (await rt.db.select().from(schema.assets).where(inArray(schema.assets.id, ids))).map(
      toAsset,
    );
    manifest = buildRightsManifest(timeline, assets);
    try {
      assertPublishable(manifest);
      publishable = { ok: true, problems: [] };
    } catch (e) {
      publishable = { ok: false, problems: e instanceof NotPublishableError ? e.problems : [String(e)] };
    }
    const byId = new Map(assets.map((a) => [a.id, a]));
    beatsVisuals = await Promise.all(
      timeline.video.map(async (c, i) => {
        const a = byId.get(c.assetId);
        return {
          beatId: script?.beats[i]?.id ?? `clip${i}`,
          text: script?.beats[i]?.text ?? "",
          assetId: c.assetId,
          source: a?.source ?? "missing",
          previewUrl: a && a.kind === "image" ? await rt.storage.signedUrl(a.storageKey, 3600) : "",
        };
      }),
    );
  }
  const render = p.renderAssetId
    ? await rt.db.query.assets.findFirst({ where: eq(schema.assets.id, p.renderAssetId) })
    : undefined;
  const videoUrl = render ? await rt.storage.signedUrl(render.storageKey, 3600) : undefined;
  const thumbUrl = render
    ? await rt.storage.signedUrl(render.storageKey.replace(/\.mp4$/, ".jpg"), 3600)
    : undefined;
  const voiceAsset = timeline?.audio[0]
    ? await rt.db.query.assets.findFirst({ where: eq(schema.assets.id, timeline.audio[0].assetId) })
    : undefined;
  const aiDisclosureRequired = manifest
    ? requiresAiDisclosure({
        manifest,
        imageStyle: p.settings.imageStyle,
        voiceProvider: voiceAsset?.licence.provider,
      })
    : false;
  const [publishes, channels] = await Promise.all([listPublishes(userId, projectId), listChannels(userId)]);
  return {
    project: p,
    script,
    aiDisclosureRequired,
    publishes,
    channels,
    job: job
      ? { id: job.id, type: job.type, status: job.status, progress: job.progress, error: job.error }
      : undefined,
    stageIndex: job ? STAGES.indexOf(job.type as (typeof STAGES)[number]) : -1,
    timeline,
    captions: timeline?.captions ?? [],
    beatsVisuals,
    manifest,
    publishable,
    videoUrl,
    thumbUrl,
    targetWords: targetWords(p.settings.targetSeconds ?? 45),
  };
}

async function rerender(userId: string, projectId: string, timeline: Timeline) {
  const rt = await runtime();
  const id = `tl_${randomUUID()}`;
  const next = Timeline.parse({ ...timeline, id });
  await rt.db.insert(schema.timelines).values({ ...next, projectId });
  const job = await rt.jobs.enqueue(
    "render",
    { timelineId: id, chain: { projectId, captionStyle: next.captionStyle } },
    { idempotencyKey: `render:${id}`, ownerId: userId },
  );
  await rt.db
    .update(schema.projects)
    .set({ timelineId: id, status: "producing", lastJobId: job.id, approvedAt: null, renderAssetId: null })
    .where(eq(schema.projects.id, projectId));
  return job.id;
}

/** Fix caption words (typos, names) and re-render. Re-renders don't use a credit. */
export async function updateCaptions(
  userId: string,
  projectId: string,
  edits: { index: number; text: string }[],
) {
  const view = await projectView(userId, projectId);
  if (!view.timeline) throw new UserError("Nothing to edit yet.");
  const captions = view.timeline.captions.map((w, i) => {
    const e = edits.find((x) => x.index === i);
    return e && e.text.trim() ? { ...w, text: e.text.trim() } : w;
  });
  return rerender(userId, projectId, { ...view.timeline, captions });
}

/** Up to 6 alternative visuals for one beat (licensed stock first). */
export async function alternatives(userId: string, projectId: string, beatIndex: number) {
  const rt = await runtime();
  const view = await projectView(userId, projectId);
  const beat = view.script?.beats[beatIndex];
  if (!beat) throw new UserError("Unknown beat");
  const results: StockResult[] = [];
  for (const provider of (await rt.providersFor(userId)).stock) {
    try {
      results.push(
        ...(await provider.search({
          query: beat.visualQuery,
          kind: "image",
          orientation: "portrait",
          perPage: 6,
        })),
      );
    } catch {
      // try the next provider
    }
    if (results.length >= 6) break;
  }
  return { query: beat.visualQuery, stock: results.slice(0, 6), canGenerate: true };
}

/** Replace one beat's visual with a stock result or a fresh AI image, then re-render. */
export async function swapVisual(
  userId: string,
  projectId: string,
  beatIndex: number,
  choice: { kind: "stock"; result: StockResult } | { kind: "ai"; prompt?: string },
) {
  const rt = await runtime();
  const view = await projectView(userId, projectId);
  if (!view.timeline) throw new UserError("Nothing to edit yet.");
  const clip = view.timeline.video[beatIndex];
  if (!clip) throw new UserError("Unknown beat");
  const asset =
    choice.kind === "stock"
      ? await importStock(choice.result, userId, rt.storage)
      : await aiSwapImage(userId, projectId, {
          prompt: choice.prompt || view.script?.beats[beatIndex]?.visualQuery || "abstract background",
          aspect: "9:16",
          style: view.project.settings.imageStyle,
          seed: Math.floor(Math.random() * 1e9),
        });
  await rt.db.insert(schema.assets).values({
    id: asset.id,
    ownerId: userId,
    kind: asset.kind,
    source: asset.source,
    licence: asset.licence,
    storageKey: asset.storageKey,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationMs: asset.durationMs ?? null,
  });
  const video = view.timeline.video.map((c, i) =>
    i === beatIndex
      ? {
          ...c,
          assetId: asset.id,
          motion: asset.kind === "image" ? ("kenburns" as const) : ("none" as const),
        }
      : c,
  );
  return rerender(userId, projectId, { ...view.timeline, video });
}

/**
 * One AI image for a swap: follows the user's routing; ShortLoop AI counts it against the swap limit and falls back
 * to the free provider when a limit is hit (ADR 0007). Any fallback is noted on the project.
 */
async function aiSwapImage(userId: string, projectId: string, req: Parameters<typeof generateImageAsset>[3]) {
  const rt = await runtime();
  const p = await rt.resolve({ ownerId: userId, projectId, swap: true });
  const gen = p.image ?? rt.image;
  try {
    return await generateImageAsset(gen, rt.storage, userId, req);
  } finally {
    if (p.notices.length) await addNotices(rt.db, projectId, p.notices);
  }
}

/** Approve for publishing: only when every asset is licensed. */
export async function approve(userId: string, projectId: string) {
  const rt = await runtime();
  const view = await projectView(userId, projectId);
  if (!view.project.renderAssetId) throw new UserError("Render the Short first.");
  if (!view.publishable.ok) throw new UserError(view.publishable.problems.join(" "));
  const now = new Date().toISOString();
  await rt.db
    .update(schema.projects)
    .set({ status: "approved", approvedAt: now })
    .where(eq(schema.projects.id, projectId));
  await recordAudit(rt.db, {
    ownerId: userId,
    type: "approve",
    subjectId: projectId,
    data: { renderAssetId: view.project.renderAssetId },
  });
}
