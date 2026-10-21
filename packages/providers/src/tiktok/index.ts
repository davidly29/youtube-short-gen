export * from "./tiktok";
export { HttpTikTok } from "./http";
export { FakeTikTok, FAKE_CREATOR } from "./fake";
import { HttpTikTok } from "./http";
import type { TikTokClient } from "./tiktok";

/** TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (a TikTok developer app with Login Kit + Content Posting) + the app's public URL. */
export function tiktokFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): TikTokClient | undefined {
  const base = env.BETTER_AUTH_URL ?? env.APP_URL;
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !base) return undefined;
  return new HttpTikTok(
    {
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      redirectUri: new URL("/publish/tiktok/callback", base).toString(),
    },
    fetchImpl,
  );
}

/** Set TIKTOK_AUDITED=1 only after TikTok approves the Content Posting audit (H-01); until then posts are private. */
export const tiktokAudited = (env: NodeJS.ProcessEnv = process.env) => env.TIKTOK_AUDITED === "1";
