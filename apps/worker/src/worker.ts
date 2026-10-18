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
import { renderHandler } from "./render";
import { scriptHandler } from "./script";
import { voiceHandler } from "./voice";

export interface WorkerProviders {
  llm?: LLM;
  tts?: TTS;
  image?: ImageGen;
  stock?: StockProvider[];
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
    visuals: unavailable("visuals", "not implemented yet"),
    render: renderHandler(deps.storage),
    publish: unavailable("publish", "not implemented yet"),
    trends: unavailable("trends", "not implemented yet"),
  };
  for (const type of JOB_TYPES) jobs.register(type, handlers[type]);
  return jobs;
}
