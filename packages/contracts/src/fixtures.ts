import type { Asset, Job, PublishRequest, Script, Timeline } from "./index";

/** Valid example objects. Tests and other packages may import these as known-good fixtures. */
export const validAsset: Asset = {
  id: "ast_1",
  ownerId: "usr_1",
  kind: "image",
  source: "stock",
  licence: {
    type: "stock",
    provider: "pexels",
    licenceUrl: "https://www.pexels.com/license/",
    attribution: "Photo by A. Photographer on Pexels",
  },
  storageKey: "assets/usr_1/ast_1.jpg",
  width: 1080,
  height: 1920,
  createdAt: "2026-10-18T12:00:00Z",
};

export const validScript: Script = {
  id: "scr_1",
  projectId: "prj_1",
  title: "Why octopuses have three hearts",
  hook: "Why does an octopus need three hearts?",
  beats: [
    {
      id: "b1",
      text: "Why does an octopus need three hearts?",
      visualQuery: "octopus close up",
      estDurationMs: 2800,
    },
    {
      id: "b2",
      text: "Two pump blood through the gills.",
      visualQuery: "octopus gills diagram",
      estDurationMs: 2600,
    },
  ],
  cta: "Follow for more ocean facts.",
  language: "en-IE",
  wordCount: 14,
};

export const validTimeline: Timeline = {
  id: "tl_1",
  fps: 30,
  width: 1080,
  height: 1920,
  durationMs: 6000,
  video: [
    { assetId: "ast_1", startMs: 0, endMs: 3000, srcInMs: 0, fit: "cover", motion: "kenburns" },
    { assetId: "ast_2", startMs: 3000, endMs: 6000, srcInMs: 0, fit: "cover", motion: "none" },
  ],
  audio: [{ assetId: "aud_1", startMs: 0, endMs: 5700, gainDb: 0 }],
  captions: [
    { text: "Why", startMs: 0, endMs: 300, emphasis: false },
    { text: "THREE", startMs: 900, endMs: 1400, emphasis: true },
  ],
  captionStyle: "bold-pop",
};

export const validJob: Job = {
  id: "job_1",
  type: "render",
  status: "running",
  progress: 0.4,
  input: { timelineId: "tl_1" },
  costCredits: 1,
  idempotencyKey: "render:tl_1",
};

export const validPublishRequest: PublishRequest = {
  platform: "youtube",
  accountId: "ch_1",
  videoAssetId: "ast_9",
  title: "Why octopuses have three hearts",
  description: "#Shorts\nPhoto by A. Photographer on Pexels",
  tags: ["octopus", "ocean", "facts"],
  privacy: "private",
  scheduledAt: "2026-10-20T18:00:00+01:00",
  aiDisclosure: true,
};
