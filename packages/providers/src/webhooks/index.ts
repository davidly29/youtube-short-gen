import { FakeWebhookSender, HttpWebhookSender, type WebhookSender } from "./webhooks";

export * from "./webhooks";

/** `WEBHOOK_SENDER=fake` records deliveries without sending them (local demos); otherwise real HTTPS. */
export function webhookSenderFromEnv(env: NodeJS.ProcessEnv = process.env): WebhookSender {
  return env.WEBHOOK_SENDER === "fake" ? new FakeWebhookSender() : new HttpWebhookSender();
}
