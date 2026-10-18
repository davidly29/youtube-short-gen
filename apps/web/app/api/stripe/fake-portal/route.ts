import { NextResponse } from "next/server";
import { getSession } from "../../../../src/server/auth";
import { fakeStripe } from "../../../../src/server/billing";

export const dynamic = "force-dynamic";

/** Fake mode only: stands in for the Customer Portal by cancelling at period end. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });
  try {
    await fakeStripe("cancel", session.user.id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return NextResponse.redirect(
    new URL(new URL(req.url).searchParams.get("returnUrl") ?? "/billing", req.url),
  );
}
