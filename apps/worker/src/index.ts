/** @shortloop/worker: runs pipeline jobs. */
export const PACKAGE_NAME = "@shortloop/worker" as const;

export { createWorker, type WorkerDeps, type WorkerProviders } from "./worker";
export { scriptHandler, PolicyBlockedError, type ScriptInput } from "./script";
export { narrationText, voiceHandler, type VoiceInput } from "./voice";
export { renderHandler, type RenderInput } from "./render";
export { stretchOverGaps, visualsHandler, type VisualsInput } from "./visuals";
export {
  addNotices,
  productionFailureListener,
  setProject,
  withProduction,
  type ProduceAfterScript,
  type ProductionChain,
} from "./chain";
export { NEEDS_KEY, PREMIUM_NEEDS_CREDIT } from "./worker";
export { loadRouting, loadUserKeys, recordKeyHealth, userKeyResolver } from "./keys";
export {
  createResolver,
  fallbackNotice,
  type PlatformDefaults,
  type ResolveContext,
  type ResolvedProviders,
  type ResolverDeps,
} from "./providers";
export {
  channelAccessToken,
  channelAad,
  ChannelError,
  ChannelLimitError,
  countConnectedChannels,
  connectYouTubeChannel,
  disconnectChannel,
} from "./channels";
export { publishHandler, PublishRefused, requeueHeldPublishes, type PublishInput } from "./publish";
export {
  DEFAULT_TRENDS_CONFIG,
  scheduleTrends,
  startTrendSchedule,
  trendsConfigFromEnv,
  trendsHandler,
  trendsJobKey,
  type TrendsConfig,
  type TrendsJobInput,
} from "./trends";
export {
  BRIEF_HOUR_UTC,
  briefHandler,
  briefJobKey,
  isBriefInput,
  scheduleBriefs,
  startBriefSchedule,
  type BriefHandlerOptions,
  type BriefJobInput,
} from "./brief";
