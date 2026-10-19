/** @shortloop/contracts: the single source of truth for data shapes shared across apps and packages. */
export const PACKAGE_NAME = "@shortloop/contracts" as const;

export { Id, IsoDateTime, MAX_SHORT_DURATION_MS, Ms } from "./common";
export { Asset, AssetKind, AssetSource, Licence, LicenceType } from "./asset";
export { Beat, Script } from "./script";
export { AudioClip, CaptionStyleId, CaptionWord, Clip, Timeline } from "./timeline";
export { Job, JobStatus, JobType } from "./job";
export {
  ChannelStatus,
  Platform,
  Privacy,
  PublishRequest,
  PublishStatus,
  publishIdempotencyKey,
} from "./publish";
export {
  ApiKeyInfo,
  ApiKeyProvider,
  DEFAULT_MODELS,
  PROVIDER_CAPABILITIES,
  ProviderCapability,
  SaveApiKey,
} from "./keys";
export { PLANS, PlanId, SubscriptionStatus, type BillingEvent, type Plan } from "./billing";
export { TrendRegion, TrendSignal, TrendSource } from "./trends";
