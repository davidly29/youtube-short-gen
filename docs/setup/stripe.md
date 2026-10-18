# Stripe for paid plans (H-06)

Until these variables are set, the Billing page shows the plans as "not switched on yet" and everyone stays on the
free 5 Shorts.

1. Create the Stripe account (test mode first). In **Product catalog** add two recurring monthly prices:
   **Creator, $29/month** and **Pro, $79/month**. Copy each price id (`price_…`).
2. **Settings → Billing → Customer portal**: allow cancelling (at period end) and switching between Creator and Pro.
3. **Developers → Webhooks → Add endpoint**: `https://web-staging-0f0b5.up.railway.app/api/stripe/webhook` with events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`. Copy the signing secret (`whsec_…`).
4. On Railway `web`, set `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREATOR` and
   `STRIPE_PRICE_PRO`. Never in the repo or chat.
5. Try it with test card `4242 4242 4242 4242`. Billing should show the plan and 30 extra Shorts.

Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then use the printed `whsec_…`.

How credits work (owner decisions, 2026-10-18)

- Each paid invoice adds the plan's monthly Shorts (and Pro's 20 AI-video credits), once per invoice, however often
  Stripe retries the webhook.
- **No rollover:** unused monthly Shorts expire at the end of that billing period. Spending uses the soonest-expiring
  credits first; the 5 free signup Shorts never expire.
- Cancelling (in the portal) keeps the plan and its Shorts until the period ends; no new Shorts after that.
