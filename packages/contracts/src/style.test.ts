import { describe, expect, it } from "vitest";
import { ChannelStyle, MIN_STYLE_VIDEOS, StyleProfile } from "./style";

const profile: StyleProfile = {
  vocabulary: ["ancient", "empire", "legion"],
  sentenceLength: 11.5,
  hookPatterns: ["Why the …?", "{n} things …"],
  bannedPhrases: ["let's dive in"],
  examples: ["Why the Roman legion never retreated"],
};

describe("StyleProfile (E4-03)", () => {
  it("accepts a valid profile and a stored channel style", () => {
    expect(StyleProfile.parse(profile)).toEqual(profile);
    expect(
      ChannelStyle.safeParse({
        channelId: "ch_1",
        profile,
        sourceVideoCount: MIN_STYLE_VIDEOS,
        enabled: true,
        builtAt: "2026-10-21T08:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("rejects empty phrases, absurd sentence lengths and too few source videos", () => {
    expect(StyleProfile.safeParse({ ...profile, bannedPhrases: [" "] }).success).toBe(false);
    expect(StyleProfile.safeParse({ ...profile, sentenceLength: 0 }).success).toBe(false);
    expect(StyleProfile.safeParse({ ...profile, examples: Array(9).fill("x") }).success).toBe(false);
    expect(
      ChannelStyle.safeParse({
        channelId: "ch_1",
        profile,
        sourceVideoCount: MIN_STYLE_VIDEOS - 1,
        enabled: true,
        builtAt: "2026-10-21T08:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
