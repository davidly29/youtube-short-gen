import { WEBHOOK_EVENTS } from "@shortloop/contracts";
import { DeveloperSettings } from "../../../../src/components/developer";
import { requireUser } from "../../../../src/server/auth";
import { listApiKeys } from "../../../../src/server/api/keys";
import { rateLimitFromEnv } from "../../../../src/server/api/rate-limit";
import { RATE_LIMIT_PER_MINUTE } from "../../../../src/server/api/spec";
import { listDeliveries, listWebhooks } from "../../../../src/server/api/webhooks";

export default async function DeveloperPage() {
  const user = await requireUser();
  const [keys, hooks] = await Promise.all([listApiKeys(user.id), listWebhooks(user.id)]);
  const webhooks = await Promise.all(
    hooks.map(async (w) => ({ ...w, deliveries: (await listDeliveries(user.id, w.id)).slice(0, 5) })),
  );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Developer</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Make and publish Shorts from your own code with the ShortLoop REST API. Keys act as you: they spend
          your credits and use your API keys and channels, and publishing still needs an approved Short. The
          full reference is at{" "}
          <a href="/api/v1/openapi.json" className="font-medium text-brand underline">
            /api/v1/openapi.json
          </a>
          .
        </p>
      </div>
      <DeveloperSettings
        keys={keys}
        webhooks={webhooks}
        events={[...WEBHOOK_EVENTS]}
        rateLimit={rateLimitFromEnv(RATE_LIMIT_PER_MINUTE)}
      />
    </div>
  );
}
