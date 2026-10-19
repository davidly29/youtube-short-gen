/** @shortloop/providers: every external service behind an interface, each with a fake for tests. */
export const PACKAGE_NAME = "@shortloop/providers" as const;

export * from "./storage";
export * from "./llm";
export * from "./tts";
export * from "./image";
export * from "./stock";
export * from "./keys";
export {
  measureLufs,
  normaliseLoudness,
  probeDurationMs,
  probeMedia,
  runFfmpeg,
  type MediaProbe,
} from "./media/ffmpeg";
export * from "./youtube";
export { cassette, type Cassette, type CassetteEntry } from "./testing/cassette";
