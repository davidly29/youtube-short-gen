import type { Asset } from "@shortloop/contracts";
import { validTimeline } from "@shortloop/contracts/fixtures";
import { describe, expect, it } from "vitest";
import {
  assertPublishable,
  attributionText,
  buildRightsManifest,
  NotPublishableError,
  withAttribution,
} from "./rights";

const at = "2026-10-18T12:00:00Z";
const stock: Asset = {
  id: "ast_1",
  ownerId: "u",
  kind: "image",
  source: "stock",
  storageKey: "k1",
  createdAt: at,
  licence: {
    type: "stock",
    provider: "pexels",
    licenceUrl: "https://www.pexels.com/license/",
    attribution: "Photo by Ann on Pexels",
  },
};
const ai: Asset = {
  id: "ast_2",
  ownerId: "u",
  kind: "image",
  source: "ai_generated",
  storageKey: "k2",
  createdAt: at,
  licence: { type: "ai_generated", provider: "fal" },
};
const voice: Asset = {
  id: "aud_1",
  ownerId: "u",
  kind: "audio",
  source: "ai_generated",
  storageKey: "k3",
  createdAt: at,
  licence: { type: "ai_generated", provider: "elevenlabs" },
};

describe("rights manifest", () => {
  it("lists each asset once with its source, licence and where it is used", () => {
    const m = buildRightsManifest(validTimeline, [stock, ai, voice], new Date(at));
    expect(m.entries.map((e) => [e.assetId, e.source, e.usedOn.join(",")])).toEqual([
      ["ast_1", "stock", "video"],
      ["ast_2", "ai_generated", "video"],
      ["aud_1", "ai_generated", "audio"],
    ]);
    expect(() => assertPublishable(m)).not.toThrow();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m); // stored as JSON beside the render
  });

  it("a timeline with an asset that has no licence cannot be published", () => {
    const m = buildRightsManifest(validTimeline, [stock, voice]);
    expect(() => assertPublishable(m)).toThrow(NotPublishableError);
    expect(() => assertPublishable(m)).toThrow(/ast_2 has no licence/);
  });

  it("uploads need an ownership attestation", () => {
    const upload: Asset = { ...ai, source: "upload", licence: { type: "owned" } };
    expect(() => assertPublishable(buildRightsManifest(validTimeline, [stock, upload, voice]))).toThrow(
      /attestation/,
    );
  });

  it("appends attribution to the description once", () => {
    const m = buildRightsManifest(validTimeline, [stock, ai, voice]);
    expect(attributionText(m)).toBe("Credits:\nPhoto by Ann on Pexels");
    const once = withAttribution("#Shorts", m);
    expect(once).toBe("#Shorts\n\nCredits:\nPhoto by Ann on Pexels");
    expect(withAttribution(once, m)).toBe(once);
  });
});
