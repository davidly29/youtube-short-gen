import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../src/server/auth";
import { startYouTubeConnect, STATE_COOKIE } from "../../../../../src/server/channels";

export const dynamic = "force-dynamic";

/** Send the user to Google's consent screen (upload, readonly and read-only analytics scopes only). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url));
  try {
    const { url, state } = await startYouTubeConnect(session.user.id);
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(req.url).protocol === "https:",
      path: "/api/channels/youtube",
      maxAge: 600,
    });
    return NextResponse.redirect(new URL(url, req.url));
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/channels?error=${encodeURIComponent((e as Error).message)}`, req.url),
    );
  }
}
