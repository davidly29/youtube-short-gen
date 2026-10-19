/** @shortloop/worker: runs pipeline jobs. */
export const PACKAGE_NAME = "@shortloop/worker" as const;

export { createWorker, type WorkerDeps, type WorkerProviders } from "./worker";
export { scriptHandler, PolicyBlockedError, type ScriptInput } from "./script";
export { narrationText, voiceHandler, type VoiceInput } from "./voice";
export { renderHandler, type RenderInput } from "./render";
export { visualsHandler, type VisualsInput } from "./visuals";
export {
  productionFailureListener,
  setProject,
  withProduction,
  type ProduceAfterScript,
  type ProductionChain,
} from "./chain";
export { NEEDS_KEY } from "./worker";
export { loadUserKeys, userKeyResolver } from "./keys";
export {
  channelAccessToken,
  channelAad,
  ChannelError,
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
