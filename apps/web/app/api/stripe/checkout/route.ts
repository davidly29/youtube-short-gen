import { NextResponse } from "next/server";
import { getSession } from "../../../../src/server/auth";
import { checkoutUrl } from "../../../../src/server/billing";

export const dynamic = "force-dynamic";

/** Form POST { plan } -> 303 to Stripe Checkout. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", req.url), 303);
  const plan = (await req.formData()).get("plan");
  try {
    return NextResponse.redirect(new URL(await checkoutUrl(session.user, plan), req.url), 303);
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/billing?error=${encodeURIComponent((e as Error).message)}`, req.url),
      303,
    );
  }
}
