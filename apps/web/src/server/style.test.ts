import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
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
    // What MCP create_short needs: an AI key (llm) and one voice.
    resolve: async () => ({ llm: { provider: "fake" }, route: {}, notices: [], usage: { premiumImages: 0 } }),
    tts: {
      voices: () => [{ id: "v1", label: "Ava", language: "en", provider: "fake", commercialUse: true }],
    },
    stock: [],
    image: { provider: "free" },
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
  const short = (channel_voice_id?: string) => ({
    topic: "why the legion marched",
    length_seconds: 45 as const,
    tone: "curious",
    caption_style: "bold-pop" as const,
    image_style: "cinematic",
    wait_seconds: 0,
    channel_voice_id,
  });

  it("enqueues the script job with the enabled profile of the user's own channel, and none otherwise", async () => {
    const { buildChannelVoice, setChannelVoiceEnabled } = await import("./style");
    const { mcpServicesFor } = await import("./mcp-services");
    const built = await buildChannelVoice(SEED.userId, ch);
    const svc = mcpServicesFor(SEED.userId);

    const withVoice = await svc.createShort(short(ch));
    expect(withVoice.status).toBe("scripting");
    expect(enqueued.at(-1)).toMatchObject({ type: "script", input: { projectId: withVoice.project_id } });
    expect(enqueued.at(-1)?.input.styleProfile).toEqual(built.profile);

    await svc.createShort(short());
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();

    await setChannelVoiceEnabled(SEED.userId, ch, false);
    await svc.createShort(short(ch));
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();
  });

  it("ignores another user's channel id (no profile used)", async () => {
    const { buildChannelVoice } = await import("./style");
    const { mcpServicesFor } = await import("./mcp-services");
    await buildChannelVoice(SEED.userId, ch);
    // Credit-exempt so the credit check doesn't stop the other user first.
    await h.db.update(schema.users).set({ creditExempt: true }).where(eq(schema.users.id, OTHER));

    const theirs = await mcpServicesFor(OTHER).createShort(short(ch));
    expect(enqueued.at(-1)).toMatchObject({ type: "script", input: { projectId: theirs.project_id } });
    expect(enqueued.at(-1)?.input.styleProfile).toBeUndefined();
  });
});
