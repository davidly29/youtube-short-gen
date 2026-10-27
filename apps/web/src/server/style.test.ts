import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { CreateShortInput } from "@shortloop/mcp";
import { FakeYouTube, SecretBox } from "@shortloop/providers";
import { connectYouTubeChannel } from "@shortloop/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "./runtime";

vi.mock("server-only", () => ({}));

const g = globalThis as unknown as { __shortloop?: Promise<Runtime> };
const box = new SecretBox("web-style-test-master-key-1234");
const OTHER = "usr_other";
let h: DbHandle;
let ch: string;
let enqueued: { type: string; input: Record<string, unknown> }[];

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  await h.db.insert(schema.users).values({ id: OTHER, email: "other@example.test", name: "Other" });
  const youtube = new FakeYouTube();
  ch = await connectYouTubeChannel(h.db, box, youtube, SEED.userId, "fake-code-1");
  enqueued = [];
  const jobs = {
    enqueue: async (type: string, input: Record<string, unknown>) => {
      enqueued.push({ type, input });
      return { id: `job_${enqueued.length}` };
    },
  };
  g.__shortloop = Promise.resolve({
    db: h.db,
    box,
    youtube,
    jobs,
    fake: true,
    providersFor: async () => ({ llm: {} }),
    tts: { voices: () => [{ id: "en-US-AriaNeural", name: "Aria" }] },
    stock: [],
    image: { provider: "free" },
    resolve: async () => ({
      llm: {},
      route: { image: "free", tts: "free" },
      notices: [],
      usage: { premiumImages: 0 },
    }),
  } as unknown as Runtime);
});
afterEach(async () => {
  delete g.__shortloop;
  await h.close();
});

const form = {
  vocabulary: "legion, empire\ncenturion",
  sentenceLength: "9",
  hookPatterns: "Why the …\n{n} …",
  bannedPhrases: "let's dive in\nfun fact",
  examples: "Why the Roman legion almost never retreated",
};

describe("channel voice in Settings (E4-03)", () => {
  it("builds from the creator's videos, then saves edits from the form", async () => {
    const { buildChannelVoice, listChannelVoices, saveChannelVoice, voiceOptions } = await import("./style");
    expect((await listChannelVoices(SEED.userId))[0]?.style).toBeUndefined();
    const built = await buildChannelVoice(SEED.userId, ch);
    expect(built.sourceVideoCount).toBeGreaterThanOrEqual(10);
    const saved = await saveChannelVoice(SEED.userId, ch, form);
    expect(saved.profile).toEqual({
      vocabulary: ["legion", "empire", "centurion"],
      sentenceLength: 9,
      hookPatterns: ["Why the …", "{n} …"],
      bannedPhrases: ["let's dive in", "fun fact"],
      examples: ["Why the Roman legion almost never retreated"],
    });
    expect((await listChannelVoices(SEED.userId))[0]?.style?.editedAt).toBeTruthy();
    expect(await voiceOptions(SEED.userId)).toEqual([{ id: ch, title: "Fake Channel" }]);
    expect(await voiceOptions(OTHER)).toEqual([]);
  });

  it("shows a readable error for bad input and for someone else's channel", async () => {
    const { buildChannelVoice, saveChannelVoice } = await import("./style");
    await buildChannelVoice(SEED.userId, ch);
    await expect(saveChannelVoice(SEED.userId, ch, { ...form, sentenceLength: "1" })).rejects.toThrow(
      "Sentence length is 3–40 words",
    );
    await expect(buildChannelVoice(OTHER, ch)).rejects.toThrow("Channel not found");
    await expect(saveChannelVoice(OTHER, ch, form)).rejects.toThrow("Channel not found");
  });
});

describe("scripts use the chosen channel voice", () => {
  it("passes the enabled profile into the script job, and nothing when it's off or not yours", async () => {
    const { buildChannelVoice, setChannelVoiceEnabled } = await import("./style");
    const { createProject, requestAiScript } = await import("./projects");
    const built = await buildChannelVoice(SEED.userId, ch);
    const base = { topic: "why the legion marched", targetSeconds: 45 as const, tone: "curious" };

    const p1 = await createProject(SEED.userId, { ...base, styleChannelId: ch });
    await requestAiScript(SEED.userId, p1);
    expect(enqueued.at(-1)?.input.styleProfile).toEqual(built.profile);

    const p2 = await createProject(SEED.userId, base);
    await requestAiScript(SEED.userId, p2);
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();

    await setChannelVoiceEnabled(SEED.userId, ch, false);
    await requestAiScript(SEED.userId, p1);
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();

    await setChannelVoiceEnabled(SEED.userId, ch, true);
    const p3 = await createProject(OTHER, { ...base, styleChannelId: ch });
    await requestAiScript(OTHER, p3);
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();
    const stored = await h.db.query.projects.findFirst({ where: eq(schema.projects.id, p1) });
    expect(stored?.settings.styleChannelId).toBe(ch);
  });
});

describe("MCP create_short uses the channel voice (E4-03b)", () => {
  const short = CreateShortInput.parse({ topic: "why the legion marched" });

  it("get_account says which channels have their voice on", async () => {
    const { buildChannelVoice, setChannelVoiceEnabled } = await import("./style");
    const { mcpServicesFor } = await import("./mcp-services");
    const voiceOf = async () => (await mcpServicesFor(SEED.userId).getAccount()).channels[0]?.voice;
    expect(await voiceOf()).toBe(false);
    await buildChannelVoice(SEED.userId, ch);
    expect(await voiceOf()).toBe(true);
    await setChannelVoiceEnabled(SEED.userId, ch, false);
    expect(await voiceOf()).toBe(false);
  });

  it("enqueues the script job with the enabled profile; none without it, when off, or for someone else's channel", async () => {
    const { buildChannelVoice, setChannelVoiceEnabled } = await import("./style");
    const { mcpServicesFor } = await import("./mcp-services");
    const built = await buildChannelVoice(SEED.userId, ch);
    const lastScript = () => enqueued.filter((j) => j.type === "script").at(-1)?.input;

    await mcpServicesFor(SEED.userId).createShort({ ...short, channel_voice_id: ch });
    expect(lastScript()?.styleProfile).toEqual(built.profile);

    await mcpServicesFor(SEED.userId).createShort(short);
    expect(lastScript()?.styleProfile).toBeUndefined();

    await mcpServicesFor(SEED.userId).createShort({ ...short, channel_voice_id: "ch_does_not_exist" });
    expect(lastScript()?.styleProfile).toBeUndefined();

    await h.db
      .insert(schema.creditLedger)
      .values({ ownerId: OTHER, delta: 5, reason: "signup", unit: "short" });
    await mcpServicesFor(OTHER).createShort({ ...short, channel_voice_id: ch });
    expect(lastScript()?.styleProfile).toBeUndefined();

    await setChannelVoiceEnabled(SEED.userId, ch, false);
    await mcpServicesFor(SEED.userId).createShort({ ...short, channel_voice_id: ch });
    expect(lastScript()?.styleProfile).toBeUndefined();
  });
});
