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
  platformProvidersFromEnv,
  secretBoxFromEnv,
  storageFromEnv,
  type ImageGen,
  type LLM,
  type SecretBox,
  type StockProvider,
  type Storage,
  type TTS,
} from "@shortloop/providers";
import { createWorker, userKeyResolver } from "@shortloop/worker";

export interface UserProviders {
  llm?: LLM;
  tts: TTS;
  image: ImageGen;
  stock: StockProvider[];
}

export interface Runtime {
  db: DbHandle["db"];
  storage: Storage;
  jobs: JobService;
  /** Platform defaults: free providers, plus the operator's keys only if SHORTLOOP_SHARED_KEYS=1. */
  llm?: LLM;
  tts: TTS;
  image: ImageGen;
  stock: StockProvider[];
  sharedKeys: boolean;
  /** Encrypts users' own API keys at rest. */
  box: SecretBox;
  /** Fake adapters and offline key checks (e2e and local demos). */
  fake: boolean;
  /** The providers a user's own keys unlock, layered over the platform defaults. */
  providersFor: (userId: string) => Promise<UserProviders>;
  /** "all-in-one": jobs run inside the web process (dev, e2e, single-container demo). */
  mode: "all-in-one" | "queue";
}

const fake = () => process.env.SHORTLOOP_FAKE_PROVIDERS === "1";

async function build(): Promise<Runtime> {
  const handle = openDb(process.env.DATABASE_URL ?? defaultDatabaseUrl());
  await handle.migrate();
  const storage = storageFromEnv();
  const box = secretBoxFromEnv();
  // Fake mode keeps the platform free of an LLM too, so e2e exercises the bring-your-own-key path.
  const platform = fake()
    ? { llm: undefined, tts: new FakeTTS(), image: new FakeImage(), stock: [], sharedKeys: false }
    : platformProvidersFromEnv();
  const { llm, tts, image, stock } = platform;
  const resolveOwn = userKeyResolver(handle.db, box, { fake: fake() });
  const providersFor = async (userId: string): Promise<UserProviders> => {
    const own = await resolveOwn(userId);
    return {
      llm: own.llm ?? llm,
      tts: own.tts ?? tts,
      image: own.image ?? image,
      stock: own.stock?.length ? own.stock : stock,
    };
  };
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
    jobs = createWorker({
      db: handle.db,
      driver,
      bus,
      storage,
      providers: { llm, tts, image, stock },
      providersFor: resolveOwn,
    });
  }
  return {
    db: handle.db,
    storage,
    jobs,
    llm,
    tts,
    image,
    stock,
    sharedKeys: platform.sharedKeys,
    box,
    fake: fake(),
    providersFor,
    mode: redisUrl ? "queue" : "all-in-one",
  };
}

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };

/** One runtime per server process (survives Next.js dev reloads). */
export function runtime(): Promise<Runtime> {
  g.__shortloop ??= build();
  return g.__shortloop;
}
