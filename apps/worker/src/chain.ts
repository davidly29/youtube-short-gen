import type { CaptionStyleId, CaptionWord } from "@shortloop/contracts";
import { schema, eq, type Db } from "@shortloop/db";
import { refund, reserve, type JobHandler, type JobService } from "@shortloop/pipeline";

/** Carried from stage to stage when a user clicks "Make my Short". */
export interface ProductionChain {
  projectId: string;
  captionStyle: CaptionStyleId;
  imageStyle?: string;
  libraryAssetIds?: string[];
  musicAssetId?: string;
  /** The job whose ledger rows hold the Short credit for this production (set by the voice stage). */
  creditJobId?: string;
  /** The visuals job that spent an AI-video credit on premium images, refunded if the production fails. */
  premiumJobId?: string;
}

/** Optional on a script job: start production (voice -> visuals -> render) as soon as the script is saved. */
export interface ProduceAfterScript {
  voiceId: string;
  captionStyle: CaptionStyleId;
  imageStyle?: string;
}

type ProjectStatus = (typeof schema.projects.$inferInsert)["status"];

export async function setProject(
  db: Db,
  projectId: string,
  patch: Partial<{
    status: ProjectStatus;
    scriptId: string;
    timelineId: string;
    renderAssetId: string;
    lastJobId: string;
    error: string | null;
    notices: string[];
  }>,
): Promise<void> {
  await db
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));
}

/**
 * Wraps stage handlers so a production runs voice -> visuals -> render on its own, keeps the
 * project's status current, and returns the reserved credit if any stage finally fails.
 */
export function withProduction(
  db: Db,
  jobs: () => JobService,
  stage: "script" | "voice" | "visuals" | "render",
  handler: JobHandler,
): JobHandler {
  return async (ctx) => {
    const input = ctx.job.input as {
      projectId?: string;
      chain?: ProductionChain;
      scriptId?: string;
      produce?: ProduceAfterScript;
    };
    const projectId = input.chain?.projectId ?? input.projectId;
    if (projectId) {
      await setProject(db, projectId, {
        status: stage === "script" ? "scripting" : "producing",
        lastJobId: ctx.job.id,
        error: null,
      });
    }
    let chain = input.chain;
    if (stage === "voice" && chain && !chain.creditJobId && projectId) {
      // A new production starts with a clean slate of notices.
      await setProject(db, projectId, { notices: [] });
    }
    if (stage === "voice" && chain && !chain.creditJobId) {
      // One Short credit per production, reserved atomically here (retries don't double-reserve).
      const held = await db.query.creditLedger.findFirst({
        where: eq(schema.creditLedger.jobId, ctx.job.id),
      });
      if (!held) await reserve(db, ctx.ownerId, { short: 1 }, ctx.job.id);
      chain = { ...chain, creditJobId: ctx.job.id };
    }
    const output = await handler(ctx);
    if (stage === "script" && projectId) {
      await setProject(db, projectId, { status: "script_ready", scriptId: output.scriptId as string });
      if (input.produce) {
        // One request from topic to video (MCP create_short): hand straight on to the voice stage.
        const voice = await jobs().enqueue(
          "voice",
          {
            scriptId: output.scriptId,
            voiceId: input.produce.voiceId,
            chain: {
              projectId,
              captionStyle: input.produce.captionStyle,
              imageStyle: input.produce.imageStyle,
            },
          },
          { idempotencyKey: `produce:${ctx.job.id}`, ownerId: ctx.ownerId },
        );
        await setProject(db, projectId, { status: "producing", lastJobId: voice.id });
      }
    }
    if (stage === "voice" && chain && input.scriptId) {
      await jobs().enqueue(
        "visuals",
        {
          scriptId: input.scriptId,
          voice: {
            audioAssetId: output.audioAssetId as string,
            durationMs: output.durationMs as number,
            words: output.words as CaptionWord[],
          },
          captionStyle: chain.captionStyle,
          imageStyle: chain.imageStyle,
          libraryAssetIds: chain.libraryAssetIds,
          musicAssetId: chain.musicAssetId,
          chain,
        },
        { idempotencyKey: `visuals:${ctx.job.id}`, ownerId: ctx.ownerId },
      );
    }
    if (stage === "visuals" && chain) {
      await setProject(db, chain.projectId, { timelineId: output.timelineId as string });
      const premiumJobId = output.premiumJobId as string | undefined;
      await jobs().enqueue(
        "render",
        { timelineId: output.timelineId, chain: premiumJobId ? { ...chain, premiumJobId } : chain },
        { idempotencyKey: `render:${output.timelineId as string}`, ownerId: ctx.ownerId },
      );
    }
    if (stage === "render" && projectId) {
      await setProject(db, projectId, { status: "ready", renderAssetId: output.videoAssetId as string });
    }
    return output;
  };
}

/** On a stage's final failure: mark the project failed and give the reserved credit back. */
export function productionFailureListener(db: Db) {
  return async (job: { id: string; type: string; input: Record<string, unknown>; error?: string }) => {
    const chain = job.input.chain as ProductionChain | undefined;
    const projectId = chain?.projectId ?? (job.input.projectId as string | undefined);
    const creditJobId = chain?.creditJobId ?? (chain && job.type === "voice" ? job.id : undefined);
    if (creditJobId) await refund(db, creditJobId);
    if (chain?.premiumJobId && chain.premiumJobId !== job.id) await refund(db, chain.premiumJobId);
    if (projectId) await setProject(db, projectId, { status: "failed", error: job.error ?? "failed" });
  };
}

/** Append notices to a project (deduplicated, at most 10), e.g. "Images: used Pollinations instead. …". */
export async function addNotices(db: Db, projectId: string, notices: string[]): Promise<void> {
  const p = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { notices: true },
  });
  if (!p) return;
  const next = [...new Set([...(p.notices ?? []), ...notices])].slice(-10);
  await db.update(schema.projects).set({ notices: next }).where(eq(schema.projects.id, projectId));
}
