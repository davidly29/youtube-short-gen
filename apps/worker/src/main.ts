import { defaultDatabaseUrl, openDb } from "@shortloop/db";
import {
  BullQueueDriver,
  expireCredits,
  MemoryEventBus,
  MemoryQueueDriver,
  RedisEventBus,
} from "@shortloop/pipeline";
import { platformProvidersFromEnv, secretBoxFromEnv, storageFromEnv } from "@shortloop/providers";
import { userKeyResolver } from "./keys";
import { createWorker } from "./worker";

const redisUrl = process.env.REDIS_URL;
const handle = openDb(defaultDatabaseUrl());
await handle.migrate();

const driver = redisUrl ? new BullQueueDriver(redisUrl, { render: 2 }) : new MemoryQueueDriver();
const bus = redisUrl ? new RedisEventBus(redisUrl) : new MemoryEventBus();
const platform = platformProvidersFromEnv();
createWorker({
  db: handle.db,
  driver,
  bus,
  storage: storageFromEnv(),
  providers: platform,
  // Each job runs on its owner's own API keys (BYOK); platform defaults fill the gaps.
  providersFor: userKeyResolver(handle.db, secretBoxFromEnv()),
});
console.log(
  `platform providers: ${platform.sharedKeys ? "operator keys shared with all users" : "free defaults only"}`,
);

// Monthly credits that weren't used expire at the end of their billing period (no rollover).
const expiry = setInterval(() => void expireCredits(handle.db).catch((e) => console.error(e)), 10 * 60_000);

console.log(`worker started (${redisUrl ? "BullMQ" : "in-memory"} queues)`);

const shutdown = async () => {
  clearInterval(expiry);
  await driver.close();
  await bus.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
