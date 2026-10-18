import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../src/server/auth";
import { finishYouTubeConnect, STATE_COOKIE } from "../../../../../src/server/channels";

export const dynamic = "force-dynamic";

const back = (req: Request, q: string) => NextResponse.redirect(new URL(`/channels?${q}`, req.url));

/** Google redirects here. Check the state (CSRF), exchange the code, store the channel. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url));
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/channels/youtube" });
  if (url.searchParams.get("error")) return back(req, "error=You+cancelled+the+YouTube+connection.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) {
    return back(req, "error=That+connection+link+expired.+Please+try+again.");
  }
  try {
    await finishYouTubeConnect(session.user.id, code);
    return back(req, "connected=1");
  } catch (e) {
    return back(req, `error=${encodeURIComponent((e as Error).message)}`);
  }
}
