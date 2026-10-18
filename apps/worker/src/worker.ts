import type { Db } from "@shortloop/db";
import {
  JOB_TYPES,
  JobService,
  type EventBus,
  type JobHandler,
  type JobType,
  type QueueDriver,
} from "@shortloop/pipeline";
import type { ImageGen, LLM, StockProvider, Storage, TTS } from "@shortloop/providers";
import { productionFailureListener, withProduction } from "./chain";
import { renderHandler } from "./render";
import { scriptHandler } from "./script";
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
  providers?: WorkerProviders;
}

/** Stages that aren't built (or configured) yet fail loudly instead of hanging. */
const unavailable =
  (type: JobType, why: string): JobHandler =>
  async () => {
    throw new Error(`the ${type} stage is ${why}`);
  };

/** Wire every pipeline stage to its handler. One queue per stage. */
export function createWorker(deps: WorkerDeps): JobService {
  const jobs = new JobService(deps.db, deps.driver, deps.bus);
  const p = deps.providers ?? {};
  const handlers: Record<JobType, JobHandler> = {
    script: p.llm
      ? scriptHandler(deps.db, p.llm)
      : unavailable("script", "not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)"),
    voice: p.tts ? voiceHandler(deps.db, p.tts, deps.storage) : unavailable("voice", "not configured"),
    visuals:
      (p.stock?.length ?? 0) > 0 || p.image
        ? visualsHandler(deps.db, deps.storage, p.stock ?? [], p.image, p.fetch)
        : unavailable("visuals", "not configured (set PEXELS_API_KEY or an image provider)"),
    render: renderHandler(deps.storage, deps.db),
    publish: unavailable("publish", "not implemented yet"),
    trends: unavailable("trends", "not implemented yet"),
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
