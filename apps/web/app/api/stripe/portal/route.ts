import { NextResponse } from "next/server";
import { getSession } from "../../../../src/server/auth";
import { portalUrl } from "../../../../src/server/billing";

export const dynamic = "force-dynamic";

/** Form POST -> 303 to the Stripe Customer Portal (cancel, change plan, update card). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url), 303);
  try {
    return NextResponse.redirect(new URL(await portalUrl(session.user.id), req.url), 303);
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/billing?error=${encodeURIComponent((e as Error).message)}`, req.url),
      303,
    );
  }
}
