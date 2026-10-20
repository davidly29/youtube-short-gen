import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, balance, eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { MemoryEventBus, MemoryQueueDriver, recordAiUsage, type JobService } from "@shortloop/pipeline";
import {
  FakeImage,
  FakeStock,
  FakeTTS,
  keyAad,
  LocalStorage,
  managedProvidersFromEnv,
  SecretBox,
  type ImageGen,
} from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResolver } from "./providers";
import { stretchOverGaps } from "./visuals";
import { createWorker, PREMIUM_NEEDS_CREDIT } from "./worker";

let h: DbHandle;
let dir: string;
let storage: LocalStorage;
let driver: MemoryQueueDriver;
const box = new SecretBox("routing-test-master-key-123456");
const ON = { MANAGED_AI_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  dir = await mkdtemp(join(tmpdir(), "routing-"));
  storage = new LocalStorage(join(dir, "store"));
  driver = new MemoryQueueDriver();
});
afterEach(async () => {
  await driver.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

/** The free image provider, labelled so tests can tell it from a user's or ShortLoop's images. */
const freeImage = (): ImageGen => {
  const fake = new FakeImage();
  return {
    provider: "pollinations",
    generate: async (r) => ({ ...(await fake.generate(r)), provider: "pollinations" }),
  };
};

const saveKey = (provider: "gemini" | "fal", key: string) =>
  h.db.insert(schema.userApiKeys).values({
    id: `key_${provider}`,
    ownerId: SEED.userId,
    provider,
    secret: box.seal(key, keyAad(SEED.userId, provider)),
    last4: key.slice(-4),
  });

const route = (r: { llm?: string; image?: string; tts?: string }) =>
  h.db.insert(schema.providerRouting).values({ ownerId: SEED.userId, ...r });

const subscribe = (plan: "creator" | "pro") =>
  h.db
    .insert(schema.subscriptions)
    .values({ userId: SEED.userId, stripeCustomerId: "cus_x", plan, status: "active" });

const draftFor = (system: string) => {
  const target = Number(/must be (\d+) ±10%/.exec(system)?.[1] ?? 78);
  const per = Math.floor((target - 3) / 5);
  const w = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  return {
    title: "Octopus hearts",
    hook: "Did you know this?",
    beats: Array.from({ length: 5 }, (_, i) => ({
      text: i === 0 ? `Did you know this? ${w(per - 4)}.` : `${w(per)}.`,
      visualQuery: `octopus scene ${i + 1}`,
    })),
    cta: "Follow for more.",
  };
};

const GEMINI_IMAGE_LIMIT_0 = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message:
      "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "0" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" },
    ],
  },
};

/** A Gemini API stand-in: text calls succeed (or fail as told), image calls return `image`. */
function geminiApi(opts: { text?: () => Response; image: () => Response }) {
  const calls = { text: 0, image: 0 };
  const f = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      systemInstruction?: { parts: { text: string }[] };
      generationConfig?: { responseModalities?: string[] };
    };
    if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
      calls.image++;
      return opts.image();
    }
    calls.text++;
    if (opts.text) return opts.text();
    const text = JSON.stringify(draftFor(body.systemInstruction?.parts[0]?.text ?? ""));
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function worker(
  deps: Partial<Parameters<typeof createResolver>[0]> & { env?: NodeJS.ProcessEnv },
): JobService {
  return createWorker({
    db: h.db,
    driver,
    bus: new MemoryEventBus(),
    storage,
    resolveProviders: createResolver({
      db: h.db,
      box,
      platform: { tts: new FakeTTS(), image: freeImage(), stock: [] },
      sleep: async () => {},
      ...deps,
    }),
  });
}

async function produce(jobs: JobService, key = "p") {
  const script = await jobs.enqueue(
    "script",
    {
      projectId: SEED.projectId,
      topic: "octopus hearts",
      targetSeconds: 30,
      tone: "curious",
      language: "en",
    },
    { idempotencyKey: `s:${key}`, ownerId: SEED.userId },
  );
  await driver.drain();
  const s = await jobs.get(script.id);
  if (s?.status !== "succeeded") return { script: s, project: undefined, images: [] };
  await jobs.enqueue(
    "voice",
    {
      scriptId: s.output?.scriptId,
      voiceId: "fake-voice",
      chain: { projectId: SEED.projectId, captionStyle: "bold-pop" },
    },
    { idempotencyKey: `v:${key}`, ownerId: SEED.userId },
  );
  await driver.drain();
  const project = await h.db.query.projects.findFirst({ where: eq(schema.projects.id, SEED.projectId) });
  // AI images made for this Short (the seed also has stock images).
  const images = await h.db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.kind, "image"), eq(schema.assets.source, "ai_generated")));
  return { script: s, project, images };
}

describe("own keys: routing, fallback and key health", () => {
  it("a free-tier Gemini key picked for images: falls back to free images once, finishes the Short, marks the key and tells the user", async () => {
    await saveKey("gemini", "AIza-free-tier");
    await route({ image: "gemini" });
    const api = geminiApi({ image: () => Response.json(GEMINI_IMAGE_LIMIT_0, { status: 429 }) });
    const { project, images } = await produce(worker({ fetch: api.f }));

    expect(project?.status, project?.error ?? "").toBe("ready");
    expect(api.calls.image).toBe(1); // a permanent refusal isn't retried, and later beats skip Gemini
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((a) => a.licence.provider === "pollinations")).toBe(true);
    expect(project?.notices.join(" ")).toMatch(
      /Images: used Pollinations instead\. Your Gemini key can't make images/,
    );

    const key = await h.db.query.userApiKeys.findFirst({ where: eq(schema.userApiKeys.provider, "gemini") });
    expect(key?.unavailable.map((u) => u.capability)).toEqual(["image"]);
    expect(key?.lastError).toMatchObject({ kind: "quota", capability: "image" });
    expect(key?.lastOkAt).toBeTruthy(); // the script call on the same key worked
  });

  it("rate limits are retried with the provider's delay before falling back", async () => {
    await saveKey("gemini", "AIza-busy");
    await route({ image: "gemini" });
    const waits: number[] = [];
    let n = 0;
    const png = await new FakeImage().generate({ prompt: "x", aspect: "9:16", outDir: dir });
    const pngB64 = Buffer.from(await (await import("node:fs/promises")).readFile(png.path)).toString(
      "base64",
    );
    const api = geminiApi({
      image: () =>
        ++n % 2 === 1
          ? Response.json(
              {
                error: {
                  code: 429,
                  message: "Resource exhausted",
                  details: [{ "@type": "x/google.rpc.RetryInfo", retryDelay: "3s" }],
                },
              },
              { status: 429 },
            )
          : Response.json({
              candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pngB64 } }] } }],
            }),
    });
    const { project, images } = await produce(
      worker({ fetch: api.f, sleep: async (ms) => void waits.push(ms) }),
    );
    expect(project?.status, project?.error ?? "").toBe("ready");
    expect(waits.every((w) => w === 3000)).toBe(true);
    expect(waits.length).toBeGreaterThan(0);
    expect(images.every((a) => a.licence.provider === "gemini")).toBe(true);
    expect(project?.notices).toEqual([]);
  });

  it("a script quota error fails the job on the first attempt with an actionable message", async () => {
    await saveKey("gemini", "AIza-out-of-quota");
    const api = geminiApi({
      text: () =>
        Response.json(
          {
            error: {
              code: 429,
              message: "Quota exceeded",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                  violations: [
                    { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" },
                  ],
                },
              ],
            },
          },
          { status: 429 },
        ),
      image: () => new Response("", { status: 500 }),
    });
    const { script } = await produce(worker({ fetch: api.f }));
    expect(script?.status).toBe("failed");
    expect(script?.error).toMatch(/Your Google Gemini account is out of quota or credit for scripts/);
    expect(api.calls.text).toBe(1);
  });
});

describe("ShortLoop AI on paid plans", () => {
  const managed = () => managedProvidersFromEnv(ON, { fake: true });

  it("a Creator with no keys gets scripts, voice and images on ShortLoop's keys, each call metered", async () => {
    await subscribe("creator");
    const { project } = await produce(worker({ managed: managed(), env: ON }));
    expect(project?.status, project?.error ?? "").toBe("ready");
    const usage = await h.db.select().from(schema.aiUsage);
    const by = (c: string) => usage.filter((u) => u.capability === c);
    expect(by("llm").length).toBeGreaterThanOrEqual(1);
    expect(by("tts")).toHaveLength(1);
    expect(by("image").length).toBeGreaterThanOrEqual(1);
    expect(
      usage.every((u) => u.ownerId === SEED.userId && u.projectId === SEED.projectId && u.costUsd > 0),
    ).toBe(true);
    const total = usage.reduce((s, u) => s + u.costUsd, 0);
    expect(total).toBeLessThan(0.25);
  });

  it("free accounts never touch ShortLoop's keys", async () => {
    const { script } = await produce(worker({ managed: managed(), env: ON }));
    expect(script?.status).toBe("failed");
    expect(script?.error).toMatch(/AI scripts need your own AI key/);
    expect(await h.db.$count(schema.aiUsage)).toBe(0);
  });

  it("over the monthly cap: images and voice use the free providers with a notice; scripts stop with a clear message", async () => {
    await subscribe("creator");
    const jobs = worker({ managed: managed(), env: ON });
    const first = await produce(jobs, "1");
    expect(first.project?.status).toBe("ready");
    await recordAiUsage(h.db, {
      ownerId: SEED.userId,
      capability: "image",
      provider: "fal",
      model: "x",
      units: 1,
      costUsd: 7.25,
      swap: false,
    });
    const scriptId = first.script?.output?.scriptId;
    const before = await h.db.$count(schema.aiUsage);
    await jobs.enqueue(
      "voice",
      { scriptId, voiceId: "fake-voice", chain: { projectId: SEED.projectId, captionStyle: "bold-pop" } },
      { idempotencyKey: "v:again", ownerId: SEED.userId },
    );
    await driver.drain();
    const project = await h.db.query.projects.findFirst({ where: eq(schema.projects.id, SEED.projectId) });
    expect(project?.status, project?.error ?? "").toBe("ready");
    expect(project?.notices).toContain(
      "You've used this month's ShortLoop AI allowance. Using the free voices instead.",
    );
    expect(project?.notices).toContain(
      "You've used this month's ShortLoop AI allowance. Using the free images instead.",
    );
    expect(await h.db.$count(schema.aiUsage)).toBe(before); // nothing more spent

    const again = await produce(jobs, "2");
    expect(again.script?.status).toBe("failed");
    expect(again.script?.error).toMatch(/this month's ShortLoop AI allowance\. Add your own AI key/);
  });

  it("premium images spend an AI-video credit on Pro; without one the Short uses standard images", async () => {
    await subscribe("pro");
    await route({ image: "shortloop_premium" });
    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: SEED.userId, unit: "ai_video_credit", delta: 1, reason: "plan_grant" });
    const jobs = worker({ managed: managed(), env: ON });
    const one = await produce(jobs, "1");
    expect(one.project?.status, one.project?.error ?? "").toBe("ready");
    expect(await balance(h.db, SEED.userId, "ai_video_credit")).toBe(0);
    const premiumCost = (await h.db.select().from(schema.aiUsage)).filter((u) => u.capability === "image")[0]
      ?.costUsd;
    expect(premiumCost).toBeCloseTo(0.045);

    const two = await produce(jobs, "2");
    expect(two.project?.status).toBe("ready");
    expect(two.project?.notices).toContain(PREMIUM_NEEDS_CREDIT);
  });
});

describe("premium images are charged only when made", () => {
  it("no AI-video credit is spent when stock covers every beat", async () => {
    await subscribe("pro");
    await route({ image: "shortloop_premium" });
    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: SEED.userId, unit: "ai_video_credit", delta: 1, reason: "plan_grant" });
    const png = await new FakeImage().generate({ prompt: "x", aspect: "9:16", outDir: dir });
    const bytes = await readFile(png.path);
    const { project } = await produce(
      worker({
        managed: managedProvidersFromEnv(ON, { fake: true }),
        env: ON,
        platform: {
          tts: new FakeTTS(),
          image: freeImage(),
          stock: [new FakeStock()],
          fetch: (async () => new Response(bytes)) as unknown as typeof fetch,
        },
      }),
    );
    expect(project?.status, project?.error ?? "").toBe("ready");
    expect(await balance(h.db, SEED.userId, "ai_video_credit")).toBe(1);
  });

  it("premium isn't offered when ShortLoop has no premium image key; standard ShortLoop images are used", async () => {
    await subscribe("pro");
    await route({ image: "shortloop_premium" });
    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: SEED.userId, unit: "ai_video_credit", delta: 1, reason: "plan_grant" });
    const m = managedProvidersFromEnv(ON, { fake: true });
    const { project } = await produce(worker({ managed: { ...m, premiumImage: undefined }, env: ON }));
    expect(project?.status, project?.error ?? "").toBe("ready");
    expect(await balance(h.db, SEED.userId, "ai_video_credit")).toBe(1);
    const images = (await h.db.select().from(schema.aiUsage)).filter((u) => u.capability === "image");
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((u) => u.costUsd < 0.01)).toBe(true);
  });
});

describe("stretchOverGaps", () => {
  it("covers beats that got no image by extending neighbouring clips", () => {
    const spans = [
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 2000 },
      { startMs: 2000, endMs: 3000 },
    ];
    const clips = [
      { startMs: 0, endMs: 1000, id: "a" },
      { startMs: 2000, endMs: 3000, id: "c" },
    ];
    expect(stretchOverGaps(clips, spans)).toEqual([
      { startMs: 0, endMs: 2000, id: "a" },
      { startMs: 2000, endMs: 3000, id: "c" },
    ]);
  });
});
