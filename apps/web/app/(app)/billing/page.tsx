import { PLANS } from "@shortloop/contracts";
import { Check, CheckCircle2, CreditCard } from "lucide-react";
import { Badge, Card, ErrorText } from "../../../src/components/ui";
import { cn } from "../../../src/lib/cn";
import { requireUser } from "../../../src/server/auth";
import { accessOf } from "../../../src/server/access";
import { billingView } from "../../../src/server/billing";
import { AccessCodeForm } from "../../../src/components/access-code-form";

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : "";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const user = await requireUser();
  const [v, q, access] = await Promise.all([billingView(user.id), searchParams, accessOf(user.id)]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Plans pay for making and publishing Shorts. AI usage runs on your own keys and is billed by those
          providers.
        </p>
      </div>
      {q.checkout === "success" && (
        <p
          className="flex items-center gap-2 rounded-lg bg-good/10 px-4 py-3 text-sm font-medium text-good"
          data-testid="checkout-success"
        >
          <CheckCircle2 className="size-4" aria-hidden /> Thanks! Your plan is active and this month’s Shorts
          have been added.
        </p>
      )}
      <ErrorText>{q.error}</ErrorText>

      <Card data-testid="current-plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">Current plan</p>
            <p className="mt-1 text-xl font-bold" data-testid="plan-name">
              {access.admin ? "Admin" : access.beta ? "Beta access" : (v.plan?.name ?? "Free")}
            </p>
            {access.unlimited && (
              <p className="mt-1 text-sm text-good" data-testid="unlimited">
                Unlimited Shorts. Your AI usage still runs on your own keys.
              </p>
            )}
            {v.plan && v.periodEnd && (
              <p className="mt-1 text-sm text-ink-soft" data-testid="plan-renewal">
                {v.cancelAtPeriodEnd
                  ? `Cancelled: active until ${date(v.periodEnd)}`
                  : `Renews ${date(v.periodEnd)}`}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold" data-testid="billing-shorts">
              {access.unlimited ? "∞" : v.shorts}{" "}
              <span className="text-sm font-medium text-ink-soft">Shorts left</span>
            </p>
            {v.aiVideo > 0 && <p className="text-sm text-ink-soft">{v.aiVideo} AI-video credits</p>}
            {v.creditsExpireAt && (
              <p className="text-xs text-ink-soft">
                This month’s Shorts expire {date(v.creditsExpireAt)} (no rollover)
              </p>
            )}
          </div>
        </div>
        {v.hasCustomer && (
          <form action="/api/stripe/portal" method="post" className="mt-4">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-paper"
              data-testid="manage"
            >
              <CreditCard className="size-4" aria-hidden /> Manage subscription
            </button>
          </form>
        )}
      </Card>

      {!access.unlimited && <AccessCodeForm />}

      {!v.enabled ? (
        <p className="text-sm text-ink-soft" data-testid="billing-off">
          Paid plans aren’t switched on yet. Everyone gets 5 free Shorts to start.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.values(PLANS).map((p) => {
            const current = v.plan?.id === p.id;
            return (
              <Card key={p.id} className={cn(current && "border-brand")} data-testid={`plan-${p.id}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  {current && <Badge tone="brand">Your plan</Badge>}
                </div>
                <p className="mt-2 text-3xl font-bold">
                  ${p.priceUsdMonthly}
                  <span className="text-sm font-medium text-ink-soft">/month</span>
                </p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="size-4 text-good" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                {!v.plan && v.available.includes(p.id) && (
                  <form action="/api/stripe/checkout" method="post" className="mt-5">
                    <input type="hidden" name="plan" value={p.id} />
                    <button
                      className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
                      data-testid={`subscribe-${p.id}`}
                    >
                      Choose {p.name}
                    </button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
