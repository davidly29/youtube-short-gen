Stripe webhook events in the shape the Stripe CLI emits (`stripe trigger …` / `stripe listen`), API version
`2026-09-30`, trimmed to the fields ShortLoop reads. Tests sign them with `stripe.webhooks.generateTestHeaderString`
and run them through `StripeBilling.parseWebhook` and `applyBillingEvent`. Replace with captured events once the
test-mode account exists (H-06): `stripe listen --print-json > events.json`.
