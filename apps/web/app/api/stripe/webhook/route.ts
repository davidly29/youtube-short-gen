import { handleWebhook } from "../../../../src/server/billing";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint. Point the Stripe dashboard (or `stripe listen --forward-to`) here with events:
 * checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // the exact bytes Stripe signed
  const sig = req.headers.get("stripe-signature") ?? req.headers.get("x-fake-signature") ?? "";
  const r = await handleWebhook(raw, sig);
  if (!r.ok) return new Response(r.status === 404 ? "Billing is off" : "Bad signature", { status: r.status });
  return Response.json({ received: true, ...r.result });
}
