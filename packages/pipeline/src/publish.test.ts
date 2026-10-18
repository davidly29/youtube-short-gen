import { describe, expect, it } from "vitest";
import type { PublishRequest } from "@shortloop/contracts";
import { nextQuotaWindow, quotaDay, quotaDayStart, requiresAiDisclosure, youtubeMetadata } from "./publish";
import type { RightsManifest } from "./rights";

const manifest = (entries: Partial<RightsManifest["entries"][number]>[]): RightsManifest => ({
  timelineId: "tl",
  generatedAt: "2026-10-18T00:00:00Z",
  entries: entries.map((e, i) => ({
    assetId: `a${i}`,
    kind: "image",
    source: "stock",
    licence: null,
    usedOn: ["video"],
    ...e,
  })),
});
const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: "youtube",
  accountId: "ch_1",
  videoAssetId: "ast_1",
  title: "Why octopuses have three hearts",
  description: "Three hearts, blue blood.",
  tags: ["octopus", "#ocean"],
  privacy: "public",
  aiDisclosure: false,
  ...over,
});

describe("youtubeMetadata (E8-02)", () => {
  it("adds #Shorts and licence credits, keeps the title within 100 chars", () => {
    const m = youtubeMetadata(
      req({ title: "x".repeat(140) }),
      manifest([{ attribution: "Photo by Ana on Pexels" }]),
      false,
    );
    expect(m.title.length).toBe(100);
    expect(m.description).toBe("Three hearts, blue blood.\n\n#Shorts\n\nCredits:\nPhoto by Ana on Pexels");
    expect(m.tags).toEqual(["octopus", "ocean"]);
    expect(m).toMatchObject({
      privacyStatus: "public",
      containsSyntheticMedia: false,
      selfDeclaredMadeForKids: false,
      categoryId: "22",
    });
    expect(youtubeMetadata(req({ description: "Go #shorts" }), manifest([]), false).description).toBe(
      "Go #shorts",
    );
  });

  it("uploads scheduled posts as private with publishAt", () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    expect(youtubeMetadata(req({ scheduledAt: at }), manifest([]), false)).toMatchObject({
      privacyStatus: "private",
      publishAt: at,
    });
  });

  it("never drops credits when the description is too long", () => {
    const m = youtubeMetadata(
      req({ description: "y".repeat(6000) }),
      manifest([{ attribution: "Video by Bo on Pixabay" }]),
      false,
    );
    expect(m.description.length).toBeLessThanOrEqual(5000);
    expect(m.description.endsWith("Credits:\nVideo by Bo on Pixabay")).toBe(true);
    expect(m.description).toContain("#Shorts");
  });

  it("caps tags at 500 characters in total", () => {
    const m = youtubeMetadata(
      req({ tags: Array.from({ length: 30 }, (_, i) => `tag${i}-${"z".repeat(20)}`) }),
      manifest([]),
      false,
    );
    expect(m.tags.join(",").length).toBeLessThanOrEqual(500);
  });

  it("labels synthetic content when required, or when the user asks", () => {
    expect(youtubeMetadata(req(), manifest([]), true).containsSyntheticMedia).toBe(true);
    expect(youtubeMetadata(req({ aiDisclosure: true }), manifest([]), false).containsSyntheticMedia).toBe(
      true,
    );
  });
});

describe("requiresAiDisclosure", () => {
  const ai = manifest([{ source: "ai_generated", kind: "image" }]);
  it("is required for realistic AI images or a realistic voice, not for illustrated styles or stock", () => {
    expect(requiresAiDisclosure({ manifest: ai, imageStyle: "photoreal" })).toBe(true);
    expect(requiresAiDisclosure({ manifest: ai, imageStyle: "cinematic" })).toBe(true);
    expect(requiresAiDisclosure({ manifest: ai, imageStyle: "anime" })).toBe(false);
    expect(requiresAiDisclosure({ manifest: manifest([{ source: "stock" }]), imageStyle: "photoreal" })).toBe(
      false,
    );
    expect(requiresAiDisclosure({ manifest: manifest([]), voiceProvider: "elevenlabs" })).toBe(true);
    expect(requiresAiDisclosure({ manifest: manifest([]), voiceProvider: "edge" })).toBe(false);
  });
});

describe("quota windows (midnight Pacific)", () => {
  it("knows the Pacific day and the next reset, across daylight saving", () => {
    expect(quotaDay(new Date("2026-10-19T06:59:00Z"))).toBe("2026-10-18"); // 23:59 PDT
    expect(quotaDay(new Date("2026-10-19T07:00:00Z"))).toBe("2026-10-19");
    expect(nextQuotaWindow(new Date("2026-10-18T21:00:00Z")).toISOString()).toBe("2026-10-19T07:00:00.000Z"); // PDT
    expect(nextQuotaWindow(new Date("2026-12-01T12:00:00Z")).toISOString()).toBe("2026-12-02T08:00:00.000Z"); // PST
    expect(nextQuotaWindow(new Date("2026-11-01T06:00:00Z")).toISOString()).toBe("2026-11-01T07:00:00.000Z"); // DST ends that day
    expect(quotaDayStart(new Date("2026-10-18T21:00:00Z")).toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(quotaDayStart(new Date("2026-11-01T20:00:00Z")).toISOString()).toBe("2026-11-01T07:00:00.000Z"); // 25-hour day
    expect(quotaDayStart(new Date("2026-11-02T09:00:00Z")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });
});
