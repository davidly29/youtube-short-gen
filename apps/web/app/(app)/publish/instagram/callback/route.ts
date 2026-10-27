import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../src/server/auth";
import { UserError } from "../../../../../src/server/errors";
import { finishInstagramConnect, INSTAGRAM_COOKIE_PATH, INSTAGRAM_STATE_COOKIE } from "../service";

export const dynamic = "force-dynamic";

/** Instagram redirects here. Check the state (CSRF), exchange the code, store the Professional account. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url));
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(INSTAGRAM_STATE_COOKIE)?.value;
  const stored = jar.get(`${INSTAGRAM_STATE_COOKIE}_back`)?.value ?? "/channels";
  const back = stored.startsWith("/publish/instagram?project=") ? stored : "/channels";
  jar.delete({ name: INSTAGRAM_STATE_COOKIE, path: INSTAGRAM_COOKIE_PATH });
  jar.delete({ name: `${INSTAGRAM_STATE_COOKIE}_back`, path: INSTAGRAM_COOKIE_PATH });
  const go = (q: string) =>
    NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}${q}`, req.url));
  if (url.searchParams.get("error")) return go("error=You+cancelled+the+Instagram+connection.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected)
    return go("error=That+connection+link+expired.+Please+try+again.");
  try {
    await finishInstagramConnect(session.user.id, code);
    return go("connected=1");
  } catch (e) {
    const message = e instanceof UserError ? e.message : "We couldn't connect Instagram. Please try again.";
    if (!(e instanceof UserError)) console.error(e);
    return go(`error=${encodeURIComponent(message)}`);
  }
}
