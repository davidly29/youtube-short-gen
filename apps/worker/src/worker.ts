import { SHORTLOOP } from "@shortloop/contracts";
import { balance, type Db } from "@shortloop/db";
import {
  InsufficientCreditsError,
  isCreditExempt,
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
  Fingerprinter,
  ImageGen,
  InstagramClient,
  PublishReelOptions,
  LLM,
  SecretBox,
  StockProvider,
  Storage,
  TrendCollector,
  TTS,
  YouTubeAnalyticsClient,
  YouTubeClient,
} from "@shortloop/providers";

import { analyticsHandler } from "./analytics";
import { briefHandler, isBriefInput } from "./brief";
import { addNotices, productionFailureListener, withProduction } from "./chain";
import type { ResolveContext, ResolvedProviders } from "./providers";
import { publishHandler, type PublishInput } from "./publish";
import { instagramPublishHandler } from "./publish-instagram";
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
  /** Instagram Login + Reels (E8-04b: INSTAGRAM_APP_ID/SECRET); without it Instagram posts report it isn't set up. */
  instagram?: InstagramClient;
  /** Reel status polling (default once a minute, 5 times); tests shorten it. */
  instagramReel?: PublishReelOptions;
  /** Public base URL for app-relative signed media links (local storage), which Instagram must fetch. */
  publicBaseUrl?: string;
  /** YouTube Analytics (E10-01); without it the daily ingest only keeps feature rows (E10-02). */
  youtubeAnalytics?: YouTubeAnalyticsClient;
  /** YouTube uploads per Pacific day before holding posts for the next window (default 100). */
  dailyUploadLimit?: number;
  /** Commercial-music check on user-supplied audio before publishing (E13-03); platform-level, not BYOK. */
  fingerprint?: Fingerprinter;
  /** FINGERPRINT_REQUIRED=1: without `fingerprint`, refuse to publish user-supplied audio. */
  requireMusicCheck?: boolean;
  /** Platform trend collectors (E3-01); without them the trends stage reports it isn't set up. */
  trendCollectors?: TrendCollector[];
  /** Clock for time-windowed stages (daily brief); defaults to the system clock. */
  now?: () => Date;
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
      premiumAvailable: false,
      usage: { premiumImages: 0 },
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
      let premium = false;
      if (p.premiumAvailable) {
        // Premium images cost one AI-video credit per Short, charged only if one is actually made.
        const exempt = await isCreditExempt(deps.db, ctx.ownerId);
        if (exempt || (await balance(deps.db, ctx.ownerId, "ai_video_credit")) >= 1) {
          premium = true;
          p = await resolve({ ...c, premium: true });
        } else p.notices.push(PREMIUM_NEEDS_CREDIT);
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
      let premiumJobId: string | undefined;
      if (premium && p.usage.premiumImages > 0) {
        const held = await deps.db.query.creditLedger.findFirst({
          where: (l, { and, eq }) => and(eq(l.jobId, ctx.job.id), eq(l.unit, "ai_video_credit")),
        });
        try {
          if (!held) await reserve(deps.db, ctx.ownerId, { ai_video_credit: 1 }, ctx.job.id);
          premiumJobId = ctx.job.id;
        } catch (e) {
          // Spent elsewhere in the meantime (a race): the images are made; don't fail the Short over it.
          if (!(e instanceof InsufficientCreditsError)) throw e;
        }
      }
      return premiumJobId ? { ...out, premiumJobId } : out;
    },
    render: renderHandler(deps.storage, deps.db),
    // One `publish` queue for every platform; the request's platform picks the handler.
    publish: (() => {
      const youtube =
        deps.youtube && deps.box
          ? publishHandler({
              db: deps.db,
              storage: deps.storage,
              box: deps.box,
              youtube: deps.youtube,
              dailyLimit: deps.dailyUploadLimit,
              fingerprint: deps.fingerprint,
              requireMusicCheck: deps.requireMusicCheck,
            })
          : unavailable(
              "publish",
              "not set up (the server needs a Google OAuth client: GOOGLE_CLIENT_ID/SECRET)",
            );
      const instagram =
        deps.instagram && deps.box
          ? instagramPublishHandler({
              db: deps.db,
              storage: deps.storage,
              box: deps.box,
              instagram: deps.instagram,
              publicBaseUrl: deps.publicBaseUrl,
              reel: deps.instagramReel,
              fingerprint: deps.fingerprint,
              requireMusicCheck: deps.requireMusicCheck,
              now: deps.now,
            })
          : unavailable(
              "publish",
              "not set up for Instagram (the server needs a Meta app: INSTAGRAM_APP_ID/SECRET)",
            );
      return (ctx) =>
        (ctx.job.input as Partial<PublishInput>).request?.platform === "instagram"
          ? instagram(ctx)
          : youtube(ctx);
    })(),
    trends: (() => {
      const collect = deps.trendCollectors
        ? trendsHandler(deps.db, deps.trendCollectors)
        : unavailable("trends", "not set up (no trend collectors configured)");
      // Daily briefs (E3-03) share the trends queue. Angles use the owner's own LLM key only (BYOK),
      // never a platform default; without one the free template is used.
      const brief = briefHandler(deps.db, {
        llmFor: async (ownerId) => {
          if (!deps.resolveProviders) return (await deps.providersFor?.(ownerId))?.llm;
          // Own key only: not ShortLoop AI (metered, platform-paid) and not the operator's shared key.
          const p = await deps.resolveProviders({ ownerId });
          return p.route.llm && p.route.llm !== SHORTLOOP ? p.llm : undefined;
        },
        now: deps.now,
      });
      return (ctx) => (isBriefInput(ctx.job.input) ? brief(ctx) : collect(ctx));
    })(),
    // Performance ingest (E10-01) + feature rows (E10-02): free, read-only, the channel's own grant.
    analytics: analyticsHandler({
      db: deps.db,
      box: deps.box,
      youtube: deps.youtube,
      analytics: deps.youtubeAnalytics,
      now: deps.now,
    }),
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
