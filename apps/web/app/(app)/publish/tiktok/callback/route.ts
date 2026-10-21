import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../src/server/auth";
import { finishTikTokConnect, TIKTOK_COOKIE_PATH, TIKTOK_STATE_COOKIE } from "../service";

export const dynamic = "force-dynamic";

/** TikTok redirects here. Check the state (CSRF), exchange the code, store the account. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url));
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(TIKTOK_STATE_COOKIE)?.value;
  const stored = jar.get(`${TIKTOK_STATE_COOKIE}_back`)?.value ?? "/channels";
  const back = stored.startsWith("/publish/tiktok?project=") ? stored : "/channels";
  jar.delete({ name: TIKTOK_STATE_COOKIE, path: TIKTOK_COOKIE_PATH });
  jar.delete({ name: `${TIKTOK_STATE_COOKIE}_back`, path: TIKTOK_COOKIE_PATH });
  const go = (q: string) =>
    NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}${q}`, req.url));
  if (url.searchParams.get("error")) return go("error=You+cancelled+the+TikTok+connection.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected)
    return go("error=That+connection+link+expired.+Please+try+again.");
  try {
    await finishTikTokConnect(session.user.id, code);
    return go("connected=1");
  } catch (e) {
    return go(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
