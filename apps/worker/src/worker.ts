import type { Db } from "@shortloop/db";
import {
  InsufficientCreditsError,
  JOB_TYPES,
  reserve,
  JobService,
  reportError,
  type EventBus,
  type JobHandler,
  type JobType,
  type QueueDriver,
} from "@shortloop/pipeline";
import type {
  ImageGen,
  LLM,
  SecretBox,
  StockProvider,
  Storage,
  TrendCollector,
  TTS,
  YouTubeClient,
} from "@shortloop/providers";
import { addNotices, productionFailureListener, withProduction } from "./chain";
import type { ResolveContext, ResolvedProviders } from "./providers";
import { publishHandler } from "./publish";
import { renderHandler } from "./render";
import { scriptHandler } from "./script";
import { trendsHandler } from "./trends";
import { visualsHandler } from "./visuals";
import { voiceHandler } from "./voice";

export interface WorkerProviders {
  llm?: LLM;
  tts?: TTS;
  image?: ImageGen;
  stock?: StockProvider[];
  /** Used to download stock media (injectable for tests). */
  fetch?: typeof fetch;
}

export interface WorkerDeps {
  db: Db;
  driver: QueueDriver;
  bus: EventBus;
  storage: Storage;
  /** Platform defaults (free providers, or shared keys if the operator opts in). */
  providers?: WorkerProviders;
  /**
   * Per-user providers from the job owner's own API keys (BYOK). Whatever it returns overrides the
   * defaults for that job, so each creator's AI usage is billed to their own accounts.
   */
  providersFor?: (ownerId: string) => Promise<WorkerProviders>;
  /**
   * Full per-job resolution (ADR 0007): routing, ShortLoop AI with its guardrails, and free fallbacks. When set,
   * it replaces `providers`/`providersFor`. See `createResolver`.
   */
  resolveProviders?: (ctx: ResolveContext) => Promise<ResolvedProviders>;
  /** Decrypts channel refresh tokens (and users' keys). Publishing needs it. */
  box?: SecretBox;
  /** YouTube client (GOOGLE_CLIENT_ID/SECRET); without it the publish stage reports it isn't set up. */
  youtube?: YouTubeClient;
  /** YouTube uploads per Pacific day before holding posts for the next window (default 100). */
  dailyUploadLimit?: number;
  /** Platform trend collectors (E3-01); without them the trends stage reports it isn't set up. */
  trendCollectors?: TrendCollector[];
}

/** Shown when a stage needs a paid provider the user hasn't connected. */
export const NEEDS_KEY = {
  llm: "AI scripts need your own AI key. Add an Anthropic, OpenAI or Gemini key in Settings → API keys.",
  tts: "No voice provider is set up.",
  visuals: "No visual source is set up. Add a Pexels or Gemini key in Settings → API keys.",
} as const;

export const PREMIUM_NEEDS_CREDIT =
  "Premium images need an AI-video credit and you have none left, so this Short used standard ShortLoop images.";

/** Stages that aren't built (or configured) yet fail loudly instead of hanging. */
const unavailable =
  (type: JobType, why: string): JobHandler =>
  async () => {
    throw new Error(`the ${type} stage is ${why}`);
  };

/** Wire every pipeline stage to its handler. One queue per stage. */
export function createWorker(deps: WorkerDeps): JobService {
  const jobs = new JobService(deps.db, deps.driver, deps.bus);
  const legacy = async (ctx: ResolveContext): Promise<ResolvedProviders> => {
    const base = deps.providers ?? {};
    const own = (await deps.providersFor?.(ctx.ownerId)) ?? {};
    return {
      llm: own.llm ?? base.llm,
      tts: own.tts ?? base.tts,
      image: own.image ?? base.image,
      stock: own.stock?.length ? own.stock : base.stock,
      fetch: base.fetch,
      route: { image: "free", tts: "free" },
      notices: [],
    };
  };
  const resolve = deps.resolveProviders ?? legacy;
  const contextOf = (ctx: { job: { id: string; input: Record<string, unknown> }; ownerId: string }) => {
    const input = ctx.job.input as { chain?: { projectId?: string }; projectId?: string };
    return { ownerId: ctx.ownerId, projectId: input.chain?.projectId ?? input.projectId, jobId: ctx.job.id };
  };
  /** Run a stage, then attach whatever the user should know (fallbacks, limits) to the project. */
  const withNotices = async <T>(
    projectId: string | undefined,
    p: ResolvedProviders,
    run: () => Promise<T>,
  ) => {
    try {
      return await run();
    } finally {
      if (projectId && p.notices.length) await addNotices(deps.db, projectId, p.notices);
    }
  };
  const handlers: Record<JobType, JobHandler> = {
    script: async (ctx) => {
      const c = contextOf(ctx);
      const p = await resolve(c);
      if (!p.llm) throw new Error(NEEDS_KEY.llm);
      const llm = p.llm;
      return withNotices(c.projectId, p, () => scriptHandler(deps.db, llm)(ctx));
    },
    voice: async (ctx) => {
      const c = contextOf(ctx);
      const p = await resolve(c);
      if (!p.tts) throw new Error(NEEDS_KEY.tts);
      const tts = p.tts;
      return withNotices(c.projectId, p, () => voiceHandler(deps.db, tts, deps.storage)(ctx));
    },
    visuals: async (ctx) => {
      const c = contextOf(ctx);
      let p = await resolve(c);
      let premiumJobId: string | undefined;
      if (p.route.image === "shortloop_premium") {
        // Premium images spend one AI-video credit per Short; without one, use standard ShortLoop images.
        try {
          const held = await deps.db.query.creditLedger.findFirst({
            where: (l, { and, eq }) => and(eq(l.jobId, ctx.job.id), eq(l.unit, "ai_video_credit")),
          });
          if (!held) await reserve(deps.db, ctx.ownerId, { ai_video_credit: 1 }, ctx.job.id);
          premiumJobId = ctx.job.id;
          p = await resolve({ ...c, premium: true });
        } catch (e) {
          if (!(e instanceof InsufficientCreditsError)) throw e;
          p.notices.push(PREMIUM_NEEDS_CREDIT);
        }
      }
      if (!(p.stock?.length ?? 0) && !p.image) throw new Error(NEEDS_KEY.visuals);
      const out = await withNotices(c.projectId, p, () =>
        visualsHandler(deps.db, deps.storage, p.stock ?? [], p.image, p.fetch)(ctx),
      );
      const gaps = Number(out.beatsWithoutOwnImage ?? 0);
      if (gaps && c.projectId)
        await addNotices(deps.db, c.projectId, [
          `${gaps} beat${gaps === 1 ? "" : "s"} couldn't get an image, so the previous image stays on screen longer. You can swap visuals below.`,
        ]);
      return premiumJobId ? { ...out, premiumJobId } : out;
    },
    render: renderHandler(deps.storage, deps.db),
    publish:
      deps.youtube && deps.box
        ? publishHandler({
            db: deps.db,
            storage: deps.storage,
            box: deps.box,
            youtube: deps.youtube,
            dailyLimit: deps.dailyUploadLimit,
          })
        : unavailable(
            "publish",
            "not set up (the server needs a Google OAuth client: GOOGLE_CLIENT_ID/SECRET)",
          ),
    trends: deps.trendCollectors
      ? trendsHandler(deps.db, deps.trendCollectors)
      : unavailable("trends", "not set up (no trend collectors configured)"),
  };
  const chained: Record<JobType, JobHandler> = {
    ...handlers,
    script: withProduction(deps.db, () => jobs, "script", handlers.script),
    voice: withProduction(deps.db, () => jobs, "voice", handlers.voice),
    visuals: withProduction(deps.db, () => jobs, "visuals", handlers.visuals),
    render: withProduction(deps.db, () => jobs, "render", handlers.render),
  };
  for (const type of JOB_TYPES) jobs.register(type, chained[type]);
  jobs.onFinalFailure(productionFailureListener(deps.db));
  // A job that used up its retries is worth a look: send it to Sentry (no-op without SENTRY_DSN).
  jobs.onFinalFailure((job) =>
    reportError(new Error(`job ${job.type} ${job.id} failed: ${job.error ?? "unknown"}`)),
  );
  return jobs;
}
