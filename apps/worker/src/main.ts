import { defaultDatabaseUrl, openDb } from "@shortloop/db";
import { BullQueueDriver, MemoryEventBus, MemoryQueueDriver, RedisEventBus } from "@shortloop/pipeline";
import {
  imageFromEnv,
  llmFromEnv,
  stockFromEnv,
  storageFromEnv,
  ttsFromEnv,
  type LLM,
} from "@shortloop/providers";
import { createWorker } from "./worker";

const redisUrl = process.env.REDIS_URL;
const handle = openDb(defaultDatabaseUrl());
await handle.migrate();

const driver = redisUrl ? new BullQueueDriver(redisUrl, { render: 2 }) : new MemoryQueueDriver();
const bus = redisUrl ? new RedisEventBus(redisUrl) : new MemoryEventBus();
let llm: LLM | undefined;
try {
  llm = llmFromEnv();
} catch (e) {
  console.warn(`script stage disabled: ${(e as Error).message}`);
}
createWorker({
  db: handle.db,
  driver,
  bus,
  storage: storageFromEnv(),
  providers: { llm, tts: ttsFromEnv(), image: imageFromEnv(), stock: stockFromEnv() },
});

console.log(`worker started (${redisUrl ? "BullMQ" : "in-memory"} queues)`);

const shutdown = async () => {
  await driver.close();
  await bus.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
