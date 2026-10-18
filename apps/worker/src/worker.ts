import type { Db } from "@shortloop/db";
import {
  JOB_TYPES,
  JobService,
  type EventBus,
  type JobHandler,
  type JobType,
  type QueueDriver,
} from "@shortloop/pipeline";
import type { Storage } from "@shortloop/providers";
import { renderHandler } from "./render";

export interface WorkerDeps {
  db: Db;
  driver: QueueDriver;
  bus: EventBus;
  storage: Storage;
}

/** Stages not built yet fail loudly instead of hanging. */
const notYet =
  (type: JobType): JobHandler =>
  async () => {
    throw new Error(`the ${type} stage is not implemented yet`);
  };

/** Wire every pipeline stage to its handler. One queue per stage. */
export function createWorker(deps: WorkerDeps): JobService {
  const jobs = new JobService(deps.db, deps.driver, deps.bus);
  const handlers: Record<JobType, JobHandler> = {
    script: notYet("script"),
    voice: notYet("voice"),
    visuals: notYet("visuals"),
    render: renderHandler(deps.storage),
    publish: notYet("publish"),
    trends: notYet("trends"),
  };
  for (const type of JOB_TYPES) jobs.register(type, handlers[type]);
  return jobs;
}
