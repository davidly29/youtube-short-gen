import "server-only";
import { defaultDatabaseUrl, openDb, type DbHandle } from "@shortloop/db";
import {
  BullQueueDriver,
  JobService,
  MemoryEventBus,
  MemoryQueueDriver,
  RedisEventBus,
  type EventBus,
  type QueueDriver,
} from "@shortloop/pipeline";
import {
  FakeImage,
  FakeTTS,
  imageFromEnv,
  llmFromEnv,
  stockFromEnv,
  storageFromEnv,
  ttsFromEnv,
  type ImageGen,
  type LLM,
  type StockProvider,
  type Storage,
  type TTS,
} from "@shortloop/providers";
import { createWorker } from "@shortloop/worker";

export interface Runtime {
  db: DbHandle["db"];
  storage: Storage;
  jobs: JobService;
  llm?: LLM;
  tts: TTS;
  image: ImageGen;
  stock: StockProvider[];
  /** "all-in-one": jobs run inside the web process (dev, e2e, single-container demo). */
  mode: "all-in-one" | "queue";
}

const fake = () => process.env.SHORTLOOP_FAKE_PROVIDERS === "1";

async function build(): Promise<Runtime> {
  const handle = openDb(process.env.DATABASE_URL ?? defaultDatabaseUrl());
  await handle.migrate();
  const storage = storageFromEnv();
  let llm: LLM | undefined;
  try {
    llm = fake() ? llmFromEnv({ ...process.env, LLM_PROVIDER: "fake" }) : llmFromEnv();
  } catch {
    llm = undefined;
  }
  const tts = fake() ? new FakeTTS() : ttsFromEnv();
  const image = fake() ? new FakeImage() : imageFromEnv();
  const stock = fake() ? [] : stockFromEnv();
  const redisUrl = process.env.REDIS_URL;
  let driver: QueueDriver;
  let bus: EventBus;
  let jobs: JobService;
  if (redisUrl) {
    driver = new BullQueueDriver(redisUrl);
    bus = new RedisEventBus(redisUrl);
    jobs = new JobService(handle.db, driver, bus); // enqueue only; the worker service runs the stages
  } else {
    driver = new MemoryQueueDriver();
    bus = new MemoryEventBus();
    jobs = createWorker({ db: handle.db, driver, bus, storage, providers: { llm, tts, image, stock } });
  }
  return { db: handle.db, storage, jobs, llm, tts, image, stock, mode: redisUrl ? "queue" : "all-in-one" };
}

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };

/** One runtime per server process (survives Next.js dev reloads). */
export function runtime(): Promise<Runtime> {
  g.__shortloop ??= build();
  return g.__shortloop;
}
