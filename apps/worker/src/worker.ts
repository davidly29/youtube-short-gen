import type { Db } from "@shortloop/db";
import {
  JOB_TYPES,
  JobService,
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
import { productionFailureListener, withProduction } from "./chain";
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

/** Stages that aren't built (or configured) yet fail loudly instead of hanging. */
const unavailable =
  (type: JobType, why: string): JobHandler =>
  async () => {
    throw new Error(`the ${type} stage is ${why}`);
  };

/** Wire every pipeline stage to its handler. One queue per stage. */
export function createWorker(deps: WorkerDeps): JobService {
  const jobs = new JobService(deps.db, deps.driver, deps.bus);
  const resolve = async (ownerId: string): Promise<WorkerProviders> => {
    const base = deps.providers ?? {};
    const own = (await deps.providersFor?.(ownerId)) ?? {};
    return {
      llm: own.llm ?? base.llm,
      tts: own.tts ?? base.tts,
      image: own.image ?? base.image,
      stock: own.stock?.length ? own.stock : base.stock,
      fetch: base.fetch,
    };
  };
  const handlers: Record<JobType, JobHandler> = {
    script: async (ctx) => {
      const p = await resolve(ctx.ownerId);
      if (!p.llm) throw new Error(NEEDS_KEY.llm);
      return scriptHandler(deps.db, p.llm)(ctx);
    },
    voice: async (ctx) => {
      const p = await resolve(ctx.ownerId);
      if (!p.tts) throw new Error(NEEDS_KEY.tts);
      return voiceHandler(deps.db, p.tts, deps.storage)(ctx);
    },
    visuals: async (ctx) => {
      const p = await resolve(ctx.ownerId);
      if (!(p.stock?.length ?? 0) && !p.image) throw new Error(NEEDS_KEY.visuals);
      return visualsHandler(deps.db, deps.storage, p.stock ?? [], p.image, p.fetch)(ctx);
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
  return jobs;
}
