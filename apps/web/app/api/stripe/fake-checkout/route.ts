import { NextResponse } from "next/server";
import { getSession } from "../../../../src/server/auth";
import { fakeStripe } from "../../../../src/server/billing";

export const dynamic = "force-dynamic";

/** Fake mode only (SHORTLOOP_FAKE_PROVIDERS=1): stands in for Stripe Checkout and its webhooks. */
export async function GET(req: Request) {
  const session = await getSession();
  const q = new URL(req.url).searchParams;
  if (!session || q.get("userId") !== session.user.id) return new Response("Not found", { status: 404 });
  try {
    await fakeStripe("checkout", session.user.id, q.get("priceId") ?? undefined);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return NextResponse.redirect(new URL(q.get("success") ?? "/billing", req.url));
}
