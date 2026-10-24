import { ShortFeatures, type PublishRequest } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportFeaturesParquet,
  FEATURE_EXPORT_COLUMNS,
  featurize,
  featurizeShort,
  hookType,
  syncFeatures,
  visualMix,
  type ShortFacts,
} from "./features";

describe("hookType", () => {
  it.each([
    ["Why do octopuses have three hearts?", "question"],
    ["3 Roman inventions we still use", "number"],
    ["Top five castles nobody visits", "number"],
    ["Why the Vikings sailed without a compass", "how_why"],
    ["How a legion built a road in a week", "how_why"],
    ["Stop believing this Viking myth", "contrarian"],
    ["Napoleon wasn't actually short", "contrarian"],
    ["The empire that ran on salt", "statement"],
  ])("%s → %s", (hook, type) => {
    expect(hookType(hook)).toBe(type);
  });
});

const facts: ShortFacts = {
  hook: "Why do octopuses have three hearts?",
  beats: 5,
  durationMs: 44_350,
  captionStyle: "bold-pop",
  voiceId: "en-US-AriaNeural",
  clips: [
    { startMs: 0, endMs: 10_000, source: "stock" },
    { startMs: 10_000, endMs: 30_000, source: "ai_generated" },
    { startMs: 30_000, endMs: 40_000, source: "upload" },
    { startMs: 40_000, endMs: 44_350, source: "render" },
  ],
  format: "myth-vs-fact",
  topicVelocity: 3.2,
  publishedAt: "2026-10-20T17:45:00Z",
};

describe("featurize (pure)", () => {
  it("describes a Short by the choices made, validated by the contract", () => {
    const f = featurize(facts);
    expect(ShortFeatures.safeParse(f).success).toBe(true);
    expect(f).toEqual({
      hookType: "question",
      hookWords: 6,
      durationS: 44.4,
      beats: 5,
      captionStyle: "bold-pop",
      voiceId: "en-US-AriaNeural",
      visualMix: { own: 0.25, stock: 0.25, ai: 0.5 },
      format: "myth-vs-fact",
      topicVelocity: 3.2,
      postHour: 17,
    });
    expect(featurize(facts)).toEqual(f);
  });

  it("no clips → an all-zero mix; a non-positive velocity → null", () => {
    expect(visualMix([])).toEqual({ own: 0, stock: 0, ai: 0 });
    expect(featurize({ ...facts, topicVelocity: 0 }).topicVelocity).toBeNull();
  });
});

describe("feature store (E10-02)", () => {
  let h: DbHandle;
  const CH = "ch_feat";
  const req = (title: string): PublishRequest => ({
    platform: "youtube",
    accountId: "acct",
    videoAssetId: SEED.assetIds[0],
    title,
    description: "",
    tags: [],
    privacy: "public",
    aiDisclosure: true,
  });
  const publish = (
    id: string,
    status: "published" | "scheduled" | "failed" | "queued",
    publishedAt: string | null,
    projectId: string | null = null,
  ) =>
    h.db.insert(schema.publishRecords).values({
      id,
      ownerId: SEED.userId,
      platform: "youtube",
      channelId: CH,
      videoAssetId: SEED.assetIds[0],
      request: req(`Title ${id}`),
      status,
      externalId: status === "published" || status === "scheduled" ? `v_${id}` : null,
      publishedAt,
      idempotencyKey: `publish:${id}`,
      projectId,
    });

  beforeEach(async () => {
    h = openDb("memory://");
    await h.migrate();
    await seed(h.db);
    await h.db.insert(schema.channels).values({
      id: CH,
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UC_feat",
      title: "History Fast",
      nicheId: "history",
    });
    // The seed project, made from a brief topic, with a script, a narration and a timeline.
    await h.db.insert(schema.assets).values({
      id: "ast_voice",
      ownerId: SEED.userId,
      kind: "audio",
      source: "ai_generated",
      licence: { type: "ai_generated", provider: "edge", model: "en-GB-RyanNeural" },
      storageKey: "voice.mp3",
    });
    await h.db.insert(schema.scripts).values({
      id: "scr_f",
      projectId: SEED.projectId,
      title: "Octopus hearts",
      hook: "3 hearts, blue blood, zero bones",
      beats: [
        { id: "b1", text: "a", visualQuery: "octopus", estDurationMs: 2000 },
        { id: "b2", text: "b", visualQuery: "heart", estDurationMs: 2000 },
      ],
      cta: "Follow.",
      language: "en",
      wordCount: 6,
    });
    await h.db.insert(schema.timelines).values({
      id: "tl_f",
      projectId: SEED.projectId,
      fps: 30,
      width: 1080,
      height: 1920,
      durationMs: 4000,
      video: [
        { assetId: SEED.assetIds[0], startMs: 0, endMs: 3000, srcInMs: 0, fit: "cover", motion: "kenburns" },
        {
          assetId: SEED.assetIds[1],
          startMs: 3000,
          endMs: 4000,
          srcInMs: 0,
          fit: "cover",
          motion: "kenburns",
        },
      ],
      audio: [{ assetId: "ast_voice", startMs: 0, endMs: 3700, gainDb: 0 }],
      captions: [],
      captionStyle: "karaoke",
    });
    await h.db
      .update(schema.projects)
      .set({ scriptId: "scr_f", timelineId: "tl_f", topicId: "top_octo", settings: { voiceId: "picked" } })
      .where(eq(schema.projects.id, SEED.projectId));
    await h.db.insert(schema.briefs).values({
      id: "brief_1",
      channelId: CH,
      date: "2026-10-19",
      generatedWith: "template",
      partial: true,
      items: [
        {
          topicId: "top_octo",
          angle: "Octopus biology",
          hook: "Octopuses: here's what changed",
          format: "myth-vs-fact",
          velocity: 4.5,
          whyNow: "x",
          sources: [{ url: "https://example.org/a", title: "a", source: "rss" }],
        },
      ],
    });
  });
  afterEach(() => h.close());

  it("featurize(shortId) reads the script, timeline, voice and brief behind a publish", async () => {
    await publish("pub_1", "published", "2026-10-20T08:15:00Z", SEED.projectId);
    expect(await featurizeShort(h.db, "pub_1")).toEqual({
      hookType: "number",
      hookWords: 6,
      durationS: 4,
      beats: 2,
      captionStyle: "karaoke",
      voiceId: "en-GB-RyanNeural",
      visualMix: { own: 0, stock: 1, ai: 0 },
      format: "myth-vs-fact",
      topicVelocity: 4.5,
      postHour: 8,
    });
  });

  it("every published Short gets a feature row (also one without a project); nothing else does", async () => {
    await publish("pub_1", "published", "2026-10-20T08:15:00Z", SEED.projectId);
    await publish("pub_2", "published", "2026-10-21T21:00:00Z"); // e.g. made before projects were linked
    await publish("pub_live", "scheduled", "2026-10-21T10:00:00Z");
    await publish("pub_future", "scheduled", "2026-12-01T10:00:00Z");
    await publish("pub_failed", "failed", null);
    await publish("pub_queued", "queued", null);
    const now = new Date("2026-10-23T09:00:00Z");
    expect(await syncFeatures(h.db, { now })).toBe(3);
    const rows = await h.db.select().from(schema.shortFeatures);
    expect(rows.map((r) => r.publishId).sort()).toEqual(["pub_1", "pub_2", "pub_live"]);
    for (const r of rows) expect(ShortFeatures.safeParse(r.features).success).toBe(true);
    const bare = rows.find((r) => r.publishId === "pub_2")?.features;
    expect(bare).toMatchObject({
      hookType: "statement",
      format: "custom",
      topicVelocity: null,
      postHour: 21,
    });
    // Idempotent: nothing missing, nothing rewritten.
    expect(await syncFeatures(h.db, { now })).toBe(0);
    // Scoped to a channel: a channel with no Shorts writes nothing.
    expect(await syncFeatures(h.db, { now: new Date("2026-12-02T00:00:00Z"), channelId: "ch_none" })).toBe(0);
  });

  it("exports the store with metric totals to Parquet for offline analysis", async () => {
    await publish("pub_1", "published", "2026-10-20T08:15:00Z", SEED.projectId);
    await publish("pub_2", "published", "2026-10-21T21:00:00Z");
    await syncFeatures(h.db, { now: new Date("2026-10-23T00:00:00Z") });
    await h.db.insert(schema.shortMetrics).values([
      {
        publishId: "pub_1",
        date: "2026-10-20",
        views: 100,
        avgViewPct: 80,
        likes: 4,
        comments: 1,
        subsGained: 1,
      },
      {
        publishId: "pub_1",
        date: "2026-10-21",
        views: 300,
        avgViewPct: 60,
        likes: 6,
        comments: 0,
        subsGained: 2,
      },
    ]);

    const bytes = await exportFeaturesParquet(h.db, { ownerId: SEED.userId });
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("PAR1");
    const meta = parquetMetadata(file);
    expect(meta.schema.slice(1).map((s) => s.name)).toEqual([...FEATURE_EXPORT_COLUMNS]);
    const rows = await parquetReadObjects({ file });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      publish_id: "pub_1",
      channel_id: CH,
      platform: "youtube",
      hook_type: "number",
      format: "myth-vs-fact",
      topic_velocity: 4.5,
      visual_stock: 1,
      post_hour: 8,
      metric_days: 2,
      views: 400,
      avg_view_pct: 65,
      likes: 10,
      subs_gained: 3,
    });
    expect((rows[0]?.published_at as Date).toISOString()).toBe("2026-10-20T08:15:00.000Z");
    expect(rows[1]).toMatchObject({
      publish_id: "pub_2",
      views: 0,
      avg_view_pct: null,
      topic_velocity: null,
    });
    expect(await exportFeaturesParquet(h.db, { ownerId: "usr_nobody" })).toBeInstanceOf(Uint8Array);
  });
});
