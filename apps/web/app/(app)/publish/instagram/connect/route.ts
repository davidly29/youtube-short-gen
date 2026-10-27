import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../src/server/auth";
import { INSTAGRAM_COOKIE_PATH, INSTAGRAM_STATE_COOKIE, startInstagramConnect } from "../service";

export const dynamic = "force-dynamic";

const backTo = (req: Request) => {
  const project = new URL(req.url).searchParams.get("project");
  return project && /^prj_[\w-]+$/.test(project) ? `/publish/instagram?project=${project}` : "/channels";
};

/** Send the user to Instagram's consent screen (basic profile + content publishing only). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url));
  const back = backTo(req);
  try {
    const { url, state } = await startInstagramConnect();
    const jar = await cookies();
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: new URL(req.url).protocol === "https:",
      path: INSTAGRAM_COOKIE_PATH,
      maxAge: 600,
    };
    jar.set(INSTAGRAM_STATE_COOKIE, state, opts);
    jar.set(`${INSTAGRAM_STATE_COOKIE}_back`, back, opts);
    return NextResponse.redirect(new URL(url, req.url));
  } catch (e) {
    const sep = back.includes("?") ? "&" : "?";
    return NextResponse.redirect(
      new URL(`${back}${sep}error=${encodeURIComponent((e as Error).message)}`, req.url),
    );
  }
}
