import "server-only";
import { defaultDatabaseUrl, openDb, type Db, type DbHandle } from "@shortloop/db";
import {
  BullQueueDriver,
  expireCredits,
  type PriceMap,
  JobService,
  MemoryEventBus,
  MemoryQueueDriver,
  RedisEventBus,
  startWebhookDispatcher,
  type EventBus,
  type QueueDriver,
} from "@shortloop/pipeline";
import {
  billingFromEnv,
  FakeBilling,
  FakeImage,
  FakeTrendCollector,
  FakeTTS,
  FakeWebhookSender,
  type BillingProvider,
  FakeFingerprint,
  FakeInstagram,
  FakeYouTube,
  instagramFromEnv,
  FakeYouTubeAnalytics,
  HttpYouTubeAnalytics,
  fingerprintFromEnv,
  fingerprintRequired,
  youtubeFromEnv,
  type InstagramClient,
  type YouTubeAnalyticsClient,
  type YouTubeClient,
  managedProvidersFromEnv,
  platformProvidersFromEnv,
  secretBoxFromEnv,
  storageFromEnv,
  type ImageGen,
  type LLM,
  type SecretBox,
  type StockProvider,
  type Storage,
  type TrendCollector,
  trendCollectorsFromEnv,
  type TTS,
  webhookSenderFromEnv,
} from "@shortloop/providers";
import {
  createResolver,
  createWorker,
  requeueHeldPublishes,
  startAnalyticsSchedule,
  startBriefSchedule,
  startTrendSchedule,
  trendsConfigFromEnv,
  type ResolveContext,
  type ResolvedProviders,
} from "@shortloop/worker";

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
  /** Encrypts users' own API keys and channel tokens at rest. */
  box: SecretBox;
  /** Stripe (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET), a fake in fake mode, or undefined when billing is off. */
  billing?: BillingProvider;
  /** Stripe price id -> plan. */
  prices: PriceMap;
  /** YouTube OAuth + upload (needs GOOGLE_CLIENT_ID/SECRET; a fake in fake mode). */
  youtube?: YouTubeClient;
  /** Read-only YouTube Analytics for connected channels (E10-01); a fake in fake mode. */
  youtubeAnalytics?: YouTubeAnalyticsClient;
  /** Instagram Login + Reels (E8-04b: INSTAGRAM_APP_ID/SECRET; a fake in fake mode). */
  instagram?: InstagramClient;
  /** Fake adapters and offline key checks (e2e and local demos). */
  fake: boolean;
  /** The providers a user's own keys unlock, layered over the platform defaults. */
  providersFor: (userId: string) => Promise<UserProviders>;
  /** Full per-request resolution (routing, ShortLoop AI guardrails, free fallbacks, notices). ADR 0007. */
  resolve: (ctx: ResolveContext) => Promise<ResolvedProviders>;
  /** "all-in-one": jobs run inside the web process (dev, e2e, single-container demo). */
  mode: "all-in-one" | "queue";
}

const fake = () => process.env.SHORTLOOP_FAKE_PROVIDERS === "1";

/** Trend collectors for the in-process worker (E3-01e): fakes in fake mode, so e2e makes no network calls. */
export function allInOneTrendCollectors(isFake: boolean): TrendCollector[] {
  return isFake ? [new FakeTrendCollector()] : trendCollectorsFromEnv();
}

/**
 * Hourly trend collection for the all-in-one runtime (E3-01e). Queue mode does nothing: the worker
 * service schedules. A bad TRENDS_* value disables collection with a log line, as the worker does.
 * Returns a stop function.
 */
export function startAllInOneTrends(
  mode: Runtime["mode"],
  jobs: JobService,
  db: Db,
  env: Record<string, string | undefined> = process.env,
): () => void {
  if (mode !== "all-in-one") return () => undefined;
  try {
    return startTrendSchedule(jobs, db, trendsConfigFromEnv(env));
  } catch (e) {
    console.error("trend collection disabled:", e instanceof Error ? e.message : e);
    return () => undefined;
  }
}

/**
 * Daily performance ingest for the all-in-one runtime (E10-01). Queue mode does nothing: the worker service
 * schedules. Returns a stop function.
 */
export function startAllInOneAnalytics(mode: Runtime["mode"], jobs: JobService, db: Db): () => void {
  if (mode !== "all-in-one") return () => undefined;
  return startAnalyticsSchedule(jobs, db);
}

/**
 * Daily brief for the all-in-one runtime (E3-03d): builds today's brief for every channel with a niche once
 * `BRIEF_HOUR_UTC` has passed (idempotent per channel and day). Queue mode does nothing: the worker service
 * schedules briefs. Returns a stop function.
 */
export function startAllInOneBriefs(
  mode: Runtime["mode"],
  jobs: JobService,
  db: Db,
  opts: { everyMs?: number; now?: () => Date } = {},
): () => void {
  if (mode !== "all-in-one") return () => undefined;
  return startBriefSchedule(jobs, db, opts);
}

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
  const billing = fake() ? new FakeBilling() : billingFromEnv();
  const prices: PriceMap = fake()
    ? { price_creator_fake: "creator", price_pro_fake: "pro" }
    : Object.fromEntries(
        [
          [process.env.STRIPE_PRICE_CREATOR, "creator"],
          [process.env.STRIPE_PRICE_PRO, "pro"],
        ].filter((e): e is [string, "creator" | "pro"] => Boolean(e[0])),
      );
  // Monthly credits that weren't used expire at the end of their billing period (no rollover).
  setInterval(() => void expireCredits(handle.db).catch((e) => console.error(e)), 10 * 60_000).unref();
  const youtube = fake() ? new FakeYouTube() : youtubeFromEnv();
  const youtubeAnalytics: YouTubeAnalyticsClient | undefined = fake()
    ? new FakeYouTubeAnalytics()
    : youtube
      ? new HttpYouTubeAnalytics()
      : undefined;
  const instagram = fake() ? new FakeInstagram() : instagramFromEnv();
  // Each job and request follows its user's routing (ADR 0007): own keys, ShortLoop AI on paid plans (metered and
  // capped), and the free providers as the fallback for images and voices.
  const resolve = createResolver({
    db: handle.db,
    box,
    platform: { llm, tts, image, stock },
    managed: managedProvidersFromEnv(process.env, { fake: fake() }),
    fake: fake(),
  });
  const providersFor = async (userId: string): Promise<UserProviders> => {
    const p = await resolve({ ownerId: userId });
    return { llm: p.llm, tts: p.tts ?? tts, image: p.image ?? image, stock: p.stock ?? stock };
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
      resolveProviders: resolve,
      box,
      youtube,
      youtubeAnalytics,
      instagram,
      // Fake Instagram finishes "processing" at once; don't wait a real minute between status checks.
      instagramReel: fake() ? { pollIntervalMs: 250 } : undefined,
      publicBaseUrl: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
      dailyUploadLimit: process.env.YOUTUBE_DAILY_UPLOAD_LIMIT
        ? Number(process.env.YOUTUBE_DAILY_UPLOAD_LIMIT)
        : undefined,
      trendCollectors: allInOneTrendCollectors(fake()),
      // Commercial-music check on uploaded audio before publishing (E13-03).
      fingerprint: fake() ? new FakeFingerprint() : fingerprintFromEnv(),
      requireMusicCheck: fingerprintRequired(),
    });
    // All-in-one mode: this process also releases posts held for YouTube's quota or Instagram's limits.
    const j = jobs;
    setInterval(
      () => void requeueHeldPublishes(handle.db, j).catch((e) => console.error(e)),
      10 * 60_000,
    ).unref();
  }
  const mode: Runtime["mode"] = redisUrl ? "queue" : "all-in-one";
  // Once per process (runtime() memoises build()).
  startAllInOneTrends(mode, jobs, handle.db);
  // Public API webhooks (E12-01): every web instance runs rounds; the delivery table's unique key dedupes them.
  const svc = jobs;
  startWebhookDispatcher(
    { db: handle.db, box, sender: fake() ? new FakeWebhookSender() : webhookSenderFromEnv() },
    { subscribe: (l) => svc.subscribe(l) },
  );
  startAllInOneAnalytics(mode, jobs, handle.db);
  startAllInOneBriefs(mode, jobs, handle.db);
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
    billing,
    prices,
    youtube,
    youtubeAnalytics,
    instagram,
    fake: fake(),
    providersFor,
    resolve,
    mode,
  };
}

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };

/** One runtime per server process (survives Next.js dev reloads). */
export function runtime(): Promise<Runtime> {
  g.__shortloop ??= build();
  return g.__shortloop;
}
