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
  FREE,
  ImageChoice,
  KeyError,
  KeyUnavailable,
  LlmChoice,
  PROVIDER_CAPABILITIES,
  ProviderCapability,
  ProviderErrorKind,
  ProviderRouting,
  resolveRouting,
  SaveApiKey,
  SHORTLOOP,
  SHORTLOOP_PREMIUM,
  VoiceChoice,
  type ResolvedRouting,
  type RoutableKey,
} from "./keys";
export {
  AiUsage,
  costOf,
  estimateTokens,
  MANAGED_DENIAL_MESSAGE,
  MANAGED_LIMITS,
  MANAGED_MONTHLY_SHARE,
  MANAGED_PRICES,
  ManagedDenial,
  ManagedTier,
  PREMIUM_PER_SHORT_USD,
  type ManagedLimits,
} from "./managed";
export {
  FREE_MAX_CHANNELS,
  PLANS,
  PlanId,
  SubscriptionStatus,
  maxChannelsFor,
  type BillingEvent,
  type Plan,
} from "./billing";
export {
  DEFAULT_NICHES,
  Niche,
  NicheId,
  Topic,
  TopicSource,
  TrendRegion,
  TrendSignal,
  TrendSource,
} from "./trends";
export { Brief, BriefDate, BriefItem, BriefSource, FormatSlug, GroundingSource } from "./brief";
export { AuditEvent, AuditEventType, TraceId } from "./audit";
export { ChannelStyle, MIN_STYLE_VIDEOS, StyleProfile } from "./style";
export {
  HookType,
  MetricDate,
  Recommendation,
  RecommendationField,
  RecommendationOverride,
  RecommendationReason,
  ShortFeatures,
  ShortMetrics,
  ShortPerformance,
  TargetSeconds,
  VisualMix,
} from "./analytics";
