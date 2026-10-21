export * from "./youtube";
export { HttpYouTube } from "./http";
export { FAKE_OWN_VIDEOS, FakeYouTube } from "./fake";
import { HttpYouTube } from "./http";
import type { YouTubeClient } from "./youtube";

/** GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (the same OAuth client as Google sign-in) + the app's public URL. */
export function youtubeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): YouTubeClient | undefined {
  const base = env.BETTER_AUTH_URL ?? env.APP_URL;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !base) return undefined;
  return new HttpYouTube(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: new URL("/api/channels/youtube/callback", base).toString(),
    },
    fetchImpl,
  );
}
