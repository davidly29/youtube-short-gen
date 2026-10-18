/** @shortloop/render: turns a Timeline into a delivery-ready MP4 (FFmpeg; see ADR 0003). */
export const PACKAGE_NAME = "@shortloop/render" as const;

export { ENCODE_AUDIO, ENCODE_VIDEO, ffmpeg, FFmpegError, probe, type ProbeResult } from "./ffmpeg";
export {
  checkDeliverySpec,
  renderTimeline,
  type AssetResolver,
  type RenderOptions,
  type ResolvedAsset,
} from "./render";
export { compareFrame, makeFixtureAssets, fixtureTimeline } from "./fixture";
export { buildAss, CAPTION_PRESETS, paginate, SAFE_AREA } from "./captions";
