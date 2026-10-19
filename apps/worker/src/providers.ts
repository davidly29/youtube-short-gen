import type { ProviderCapability, ResolvedRouting } from "@shortloop/contracts";
import type { Db } from "@shortloop/db";
import {
  managedDenial,
  managedDenialMessage,
  managedTier,
  recordAiUsage,
  reportError,
} from "@shortloop/pipeline";
import {
  FallbackImage,
  FallbackTTS,
  InstrumentedImage,
  InstrumentedLLM,
  InstrumentedTTS,
  PROVIDER_LABEL,
  ProviderError,
  providersFromKeys,
  type ImageGen,
  type Instrumentation,
  type LLM,
  type ManagedProviders,
  type OnFallback,
  type ProviderEvent,
  type SecretBox,
  type StockProvider,
  type TTS,
} from "@shortloop/providers";
import { loadRouting, loadUserKeys, recordKeyHealth } from "./keys";

/**
 * Per-job provider resolution (ADR 0007): the user's routing choices over their own keys, ShortLoop AI for paid
 * plans (metered and capped), and the free providers as the fallback for images and voices. Notices collect what
 * the user should know (e.g. "used free images because…") so the job can attach them to the project.
 */

export interface ResolveContext {
  ownerId: string;
  projectId?: string;
  jobId?: string;
  /** A visual swap on the review screen (counts against the swap limit). */
  swap?: boolean;
  /** This Short has spent an AI-video credit, so ShortLoop premium images may be used. */
  premium?: boolean;
}

export interface ResolvedProviders {
  llm?: LLM;
  tts?: TTS;
  image?: ImageGen;
  stock?: StockProvider[];
  fetch?: typeof fetch;
  route: ResolvedRouting;
  /** User-facing notes about fallbacks during this job. */
  notices: string[];
}

export interface PlatformDefaults {
  /** Only when the operator shares env keys with everyone (SHORTLOOP_SHARED_KEYS=1). */
  llm?: LLM;
  /** Free providers (or shared keys). */
  tts?: TTS;
  image?: ImageGen;
  stock?: StockProvider[];
  fetch?: typeof fetch;
}

export interface ResolverDeps {
  db: Db;
  box?: SecretBox;
  platform: PlatformDefaults;
  managed?: ManagedProviders;
  fake?: boolean;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** For tests: skip real waits on rate limits. */
  sleep?: (ms: number) => Promise<void>;
}

const JOB_LABEL: Record<ProviderCapability, string> = {
  llm: "Script",
  image: "Images",
  tts: "Voice",
  stock: "Stock",
};

/** The notice shown on the project when a job fell back to a free provider. */
export function fallbackNotice(capability: ProviderCapability, error: unknown, to: string): string {
  const free = PROVIDER_LABEL[to] ?? to;
  if (error instanceof ProviderError && error.provider === "shortloop") return error.message;
  const why = error instanceof Error ? error.message : String(error);
  return `${JOB_LABEL[capability]}: used ${free} instead. ${why}`;
}

export function createResolver(deps: ResolverDeps): (ctx: ResolveContext) => Promise<ResolvedProviders> {
  const env = deps.env ?? process.env;
  const managed = deps.managed ?? {};
  const anyManaged = Boolean(managed.llm || managed.image || managed.tts);

  return async (ctx) => {
    const { db, platform } = deps;
    const keys = deps.box ? await loadUserKeys(db, deps.box, ctx.ownerId) : [];
    const routing = deps.box ? await loadRouting(db, ctx.ownerId) : {};
    const tier = anyManaged ? await managedTier(db, ctx.ownerId) : undefined;
    const set = providersFromKeys(keys, {
      routing,
      managed: Boolean(tier),
      fake: deps.fake,
      fetch: deps.fetch,
    });
    const route = set.route;
    const notices: string[] = [];
    const seen = new Set<string>();
    const notice = (text: string) => {
      if (!seen.has(text)) {
        seen.add(text);
        notices.push(text);
      }
    };

    const report = async (e: ProviderEvent) => {
      await recordKeyHealth(db, ctx.ownerId, e);
      // Our own keys failing is an operations problem: tell Sentry, not just the user.
      if (e.source === "shortloop" && e.error && e.error.provider !== "shortloop") reportError(e.error);
    };
    const own: Instrumentation = { source: "own", report, sleep: deps.sleep };
    const free: Instrumentation = { source: "free", sleep: deps.sleep };
    const shortloop = (price: Instrumentation["price"]): Instrumentation => ({
      source: "shortloop",
      report,
      sleep: deps.sleep,
      price,
      guard: async (capability) => {
        if (!tier) return "ShortLoop AI isn't included in your plan.";
        const denial = await managedDenial(
          db,
          {
            ownerId: ctx.ownerId,
            tier,
            projectId: ctx.projectId,
            jobId: ctx.jobId,
            swap: ctx.swap,
            premium: ctx.premium,
            env,
          },
          capability,
        );
        return denial ? managedDenialMessage(denial, capability) : undefined;
      },
      meter: (u) =>
        recordAiUsage(db, {
          ownerId: ctx.ownerId,
          projectId: ctx.projectId,
          jobId: ctx.jobId,
          capability: u.capability,
          provider: u.provider,
          model: u.model,
          units: u.units,
          costUsd: u.costUsd,
          swap: Boolean(ctx.swap && u.capability === "image"),
        }),
    });
    const onFallback: OnFallback = (e) => notice(fallbackNotice(e.capability, e.error, e.to));

    // Scripts: own key, ShortLoop AI, or the operator's shared key. There is no free fallback.
    let llm: LLM | undefined;
    if (set.llm) llm = new InstrumentedLLM(set.llm, own);
    else if (route.llm === "shortloop" && managed.llm)
      llm = new InstrumentedLLM(managed.llm.provider, shortloop(managed.llm.price));
    else llm = platform.llm;

    // Images: primary (own key or ShortLoop AI) with the free provider behind it.
    const freeImage = platform.image ? new InstrumentedImage(platform.image, free) : undefined;
    let primaryImage: ImageGen | undefined;
    if (set.image) primaryImage = new InstrumentedImage(set.image, own);
    else if (route.image === "shortloop_premium" && ctx.premium && managed.premiumImage)
      primaryImage = new InstrumentedImage(
        managed.premiumImage.provider,
        shortloop(managed.premiumImage.price),
      );
    else if ((route.image === "shortloop" || route.image === "shortloop_premium") && managed.image)
      primaryImage = new InstrumentedImage(managed.image.provider, shortloop(managed.image.price));
    const image =
      primaryImage && freeImage
        ? new FallbackImage(primaryImage, freeImage, onFallback)
        : (primaryImage ?? freeImage);

    // Voices: same shape as images.
    const freeTts = platform.tts ? new InstrumentedTTS(platform.tts, free) : undefined;
    let primaryTts: TTS | undefined;
    if (set.tts) primaryTts = new InstrumentedTTS(set.tts, own);
    else if (route.tts === "shortloop" && managed.tts)
      primaryTts = new InstrumentedTTS(managed.tts.provider, shortloop(managed.tts.price));
    const tts =
      primaryTts && freeTts ? new FallbackTTS(primaryTts, freeTts, onFallback) : (primaryTts ?? freeTts);

    return {
      llm,
      image,
      tts,
      stock: set.stock.length ? set.stock : platform.stock,
      fetch: platform.fetch,
      route,
      notices,
    };
  };
}
