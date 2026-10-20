import { defaultDatabaseUrl, openDb } from "@shortloop/db";
import {
  BullQueueDriver,
  expireCredits,
  initTelemetry,
  MemoryEventBus,
  MemoryQueueDriver,
  RedisEventBus,
} from "@shortloop/pipeline";
import {
  managedProvidersFromEnv,
  platformProvidersFromEnv,
  secretBoxFromEnv,
  storageFromEnv,
  trendCollectorsFromEnv,
  youtubeFromEnv,
} from "@shortloop/providers";

import { startBriefSchedule } from "./brief";
import { userKeyResolver } from "./keys";
import { createResolver } from "./providers";

import { requeueHeldPublishes } from "./publish";
import { startTrendSchedule, trendsConfigFromEnv } from "./trends";
import { createWorker } from "./worker";

// Traces (OTEL_EXPORTER_OTLP_ENDPOINT) and errors (SENTRY_DSN) are only exported when configured.
const telemetry = await initTelemetry({ serviceName: "shortloop-worker" });
const redisUrl = process.env.REDIS_URL;
const handle = openDb(defaultDatabaseUrl());
await handle.migrate();

const driver = redisUrl ? new BullQueueDriver(redisUrl, { render: 2 }) : new MemoryQueueDriver();
const bus = redisUrl ? new RedisEventBus(redisUrl) : new MemoryEventBus();
const platform = platformProvidersFromEnv();
const box = secretBoxFromEnv();
const jobs = createWorker({
  db: handle.db,
  driver,
  bus,
  storage: storageFromEnv(),
  providers: platform,
  // Each job follows its owner's routing (ADR 0007): their own keys, ShortLoop AI on paid plans (metered and
  // capped), and the free providers as the fallback for images and voices.
  resolveProviders: createResolver({ db: handle.db, box, platform, managed: managedProvidersFromEnv() }),
  box,
  youtube: youtubeFromEnv(),
  dailyUploadLimit: process.env.YOUTUBE_DAILY_UPLOAD_LIMIT
    ? Number(process.env.YOUTUBE_DAILY_UPLOAD_LIMIT)
    : undefined,
  // Trend radar (E3-01): free official APIs, platform-level, no user keys or credits.
  trendCollectors: trendCollectorsFromEnv(),
});
// Posts held for YouTube's daily quota go out when the next window opens.
const sweep = setInterval(
  () => void requeueHeldPublishes(handle.db, jobs).catch((e) => console.error(e)),
  10 * 60_000,
);
console.log(
  `platform providers: ${platform.sharedKeys ? "operator keys shared with all users" : "free defaults only"}; ShortLoop AI ${process.env.MANAGED_AI_ENABLED === "1" ? "on" : "off"}`,
);

// Monthly credits that weren't used expire at the end of their billing period (no rollover).
const expiry = setInterval(() => void expireCredits(handle.db).catch((e) => console.error(e)), 10 * 60_000);

// Hourly trend collection (one job per region + one for niche feeds; idempotent per hour).
let stopTrends: () => void = () => undefined;
try {
  stopTrends = startTrendSchedule(jobs, handle.db, trendsConfigFromEnv());
} catch (e) {
  console.error("trend collection disabled:", e instanceof Error ? e.message : e);
}

// Daily brief per channel with a niche (E3-03), from 05:00 UTC; idempotent per channel and day.
const stopBriefs = startBriefSchedule(jobs, handle.db);

console.log(`worker started (${redisUrl ? "BullMQ" : "in-memory"} queues)`);

const shutdown = async () => {
  stopTrends();
  stopBriefs();
  clearInterval(expiry);
  clearInterval(sweep);
  await driver.close();
  await bus.close();
  await handle.close();
  await telemetry.shutdown();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
