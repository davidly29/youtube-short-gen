import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { FAKE_OWN_VIDEOS, FakeYouTube, SecretBox } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectYouTubeChannel } from "./channels";
import { buildStyleProfile, getChannelStyle, StyleError, styleForScript, updateChannelStyle } from "./style";

let h: DbHandle;
let yt: FakeYouTube;
let ch: string;
const box = new SecretBox("style-test-master-key-12345678");

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
  yt = new FakeYouTube();
  ch = await connectYouTubeChannel(h.db, box, yt, SEED.userId, "fake-code-1");
});
afterEach(() => h.close());

describe("buildStyleProfile (E4-03)", () => {
  it("builds from >= 10 of the creator's own public uploads and stores it, enabled", async () => {
    const style = await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    expect(style.sourceVideoCount).toBe(FAKE_OWN_VIDEOS.length);
    expect(style.enabled).toBe(true);
    expect(style.profile.vocabulary).toContain("legion");
    expect(await getChannelStyle(h.db, SEED.userId, ch)).toEqual(style);
    const audit = await h.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.type, "style_profile.built"));
    expect(audit).toHaveLength(1);
  });

  it("refuses with fewer than 10 public videos (private and unlisted don't count)", async () => {
    yt.videos = FAKE_OWN_VIDEOS.map((v, i) => (i < 4 ? { ...v, privacyStatus: "private" as const } : v));
    await expect(buildStyleProfile(h.db, box, yt, SEED.userId, ch)).rejects.toThrow(/at least 10.*found 8/);
    expect(await getChannelStyle(h.db, SEED.userId, ch)).toBeUndefined();
  });

  it("only the channel's owner can build, read, edit or use it", async () => {
    await h.db.insert(schema.users).values({ id: "usr_other", email: "other@x.test" });
    await expect(buildStyleProfile(h.db, box, yt, "usr_other", ch)).rejects.toBeInstanceOf(StyleError);
    await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    expect(await getChannelStyle(h.db, "usr_other", ch)).toBeUndefined();
    expect(await styleForScript(h.db, "usr_other", ch)).toBeUndefined();
    await expect(updateChannelStyle(h.db, "usr_other", ch, { enabled: false })).rejects.toBeInstanceOf(
      StyleError,
    );
  });
});

describe("editing the channel voice", () => {
  it("saves edits, can be switched off without losing it, and rebuilding keeps banned phrases", async () => {
    const built = await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    const profile = {
      ...built.profile,
      vocabulary: ["centurion", ...built.profile.vocabulary],
      bannedPhrases: [...built.profile.bannedPhrases, "fun fact"],
    };
    const edited = await updateChannelStyle(h.db, SEED.userId, ch, { profile });
    expect(edited.profile.vocabulary[0]).toBe("centurion");
    expect(edited.editedAt).toBeTruthy();
    expect(await styleForScript(h.db, SEED.userId, ch)).toEqual(profile);

    await updateChannelStyle(h.db, SEED.userId, ch, { enabled: false });
    expect(await styleForScript(h.db, SEED.userId, ch)).toBeUndefined();
    expect((await getChannelStyle(h.db, SEED.userId, ch))?.profile.vocabulary[0]).toBe("centurion");

    const rebuilt = await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    expect(rebuilt.enabled).toBe(false);
    expect(rebuilt.editedAt).toBeUndefined();
    expect(rebuilt.profile.bannedPhrases).toContain("fun fact");
    expect(rebuilt.profile.vocabulary).not.toContain("centurion");
  });

  it("rejects an invalid edit", async () => {
    const built = await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    await expect(
      updateChannelStyle(h.db, SEED.userId, ch, { profile: { ...built.profile, sentenceLength: 0 } }),
    ).rejects.toThrow();
  });

  it("is not used once the channel is disconnected", async () => {
    await buildStyleProfile(h.db, box, yt, SEED.userId, ch);
    await h.db.update(schema.channels).set({ status: "disconnected" }).where(eq(schema.channels.id, ch));
    expect(await styleForScript(h.db, SEED.userId, ch)).toBeUndefined();
  });
});
