export * from "./instagram";
export { INSTAGRAM_GRAPH, HttpInstagram } from "./http";
export { FakeInstagram } from "./fake";
import { HttpInstagram } from "./http";
import type { InstagramClient } from "./instagram";

/** INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (a Meta app with Instagram Login) + the app's public URL. */
export function instagramFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): InstagramClient | undefined {
  const base = env.BETTER_AUTH_URL ?? env.APP_URL;
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET || !base) return undefined;
  return new HttpInstagram(
    {
      clientId: env.INSTAGRAM_APP_ID,
      clientSecret: env.INSTAGRAM_APP_SECRET,
      redirectUri: new URL("/publish/instagram/callback", base).toString(),
    },
    fetchImpl,
  );
}
