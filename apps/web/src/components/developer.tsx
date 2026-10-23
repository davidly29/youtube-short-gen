"use client";
import type { PublicApiKey, Webhook, WebhookDelivery } from "@shortloop/contracts";
import { Copy, KeyRound, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  revokeApiKeyAction,
} from "../../app/(app)/settings/developer/actions";
import { Badge, Button, Card, ErrorText, Input, Label } from "./ui";

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Shown once, right after creation: the user must copy it now. */
function Reveal({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-3" data-testid={testId}>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-xs"
          data-testid={`${testId}-value`}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">It won’t be shown again. Store it somewhere safe.</p>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  async function run<T>(id: string, fn: () => Promise<ActionResult<T>>): Promise<T | undefined> {
    setBusy(id);
    setError(undefined);
    const res = await fn();
    setBusy(undefined);
    if (!res.ok) {
      setError(res.error);
      return undefined;
    }
    router.refresh();
    return res.value;
  }
  return { busy, error, run };
}

function ApiKeysCard({ keys, rateLimit }: { keys: PublicApiKey[]; rateLimit: number }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string>();
  return (
    <Card data-testid="api-keys-card" className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold">API keys</h2>
      </div>
      <p className="text-sm text-ink-soft">
        Send a key as <code>Authorization: Bearer sl_…</code>. Each key allows {rateLimit} requests a minute.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("create", () => createApiKeyAction(name)).then((key) => {
            if (key) {
              setFresh(key);
              setName("");
            }
          });
        }}
      >
        <div className="flex-1">
          <Label htmlFor="api-key-name">Key name</Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zapier, my scheduler"
            maxLength={60}
          />
        </div>
        <Button type="submit" loading={busy === "create"} data-testid="api-key-create">
          Create key
        </Button>
      </form>
      {fresh && <Reveal label="Your new API key" value={fresh} testId="api-key-new" />}
      <ErrorText>{error}</ErrorText>
      {keys.length === 0 ? (
        <p className="text-sm text-ink-soft">No keys yet.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="api-key-list">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-3" data-testid="api-key-row">
              <div className="min-w-0">
                <p className="font-medium">{k.name}</p>
                <p className="text-xs text-ink-soft">
                  <code>{k.prefix}…</code> · created {when(k.created_at)} · last used {when(k.last_used_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                loading={busy === k.id}
                onClick={() => void run(k.id, () => revokeApiKeyAction(k.id))}
                data-testid="api-key-revoke"
              >
                <Trash2 className="size-4" aria-hidden /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const DELIVERY_TONE = { delivered: "good", pending: "warn", failed: "bad" } as const;

function WebhooksCard({
  webhooks,
  events,
}: {
  webhooks: (Webhook & { deliveries: WebhookDelivery[] })[];
  events: string[];
}) {
  const { busy, error, run } = useAction();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>(events);
  const [fresh, setFresh] = useState<string>();
  return (
    <Card data-testid="webhooks-card" className="space-y-4">
      <div className="flex items-center gap-2">
        <WebhookIcon className="size-5 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold">Webhooks</h2>
      </div>
      <p className="text-sm text-ink-soft">
        ShortLoop POSTs JSON to your HTTPS URL when a Short finishes rendering, fails, or is published. Check
        the <code>ShortLoop-Signature</code> header with your signing secret.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("create", () => createWebhookAction(url, picked)).then((secret) => {
            if (secret) {
              setFresh(secret);
              setUrl("");
            }
          });
        }}
      >
        <div>
          <Label htmlFor="webhook-url">Endpoint URL</Label>
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/shortloop"
          />
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1.5 text-sm font-medium">Events</legend>
          {events.map((ev) => (
            <label key={ev} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={picked.includes(ev)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))
                }
              />
              <code>{ev}</code>
            </label>
          ))}
        </fieldset>
        <Button type="submit" loading={busy === "create"} data-testid="webhook-create">
          Add webhook
        </Button>
      </form>
      {fresh && <Reveal label="Signing secret" value={fresh} testId="webhook-secret" />}
      <ErrorText>{error}</ErrorText>
      {webhooks.length === 0 ? (
        <p className="text-sm text-ink-soft">No webhooks yet.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="webhook-list">
          {webhooks.map((w) => (
            <li key={w.id} className="space-y-2 py-3" data-testid="webhook-row">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{w.url}</p>
                  <p className="text-xs text-ink-soft">{w.events.join(" · ")}</p>
                </div>
                <Button
                  variant="ghost"
                  loading={busy === w.id}
                  onClick={() => void run(w.id, () => deleteWebhookAction(w.id))}
                  data-testid="webhook-delete"
                >
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              </div>
              {w.deliveries.length > 0 && (
                <ul className="space-y-1 text-xs" data-testid="webhook-deliveries">
                  {w.deliveries.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Badge tone={DELIVERY_TONE[d.status]}>{d.status}</Badge>
                      <code>{d.event}</code>
                      <span className="text-ink-soft">
                        {when(d.created_at)}
                        {d.response_status ? ` · HTTP ${d.response_status}` : ""}
                        {d.error && d.status !== "delivered" ? ` · ${d.error}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Settings → Developer: REST API keys and webhooks (E12-01). */
export function DeveloperSettings({
  keys,
  webhooks,
  events,
  rateLimit,
}: {
  keys: PublicApiKey[];
  webhooks: (Webhook & { deliveries: WebhookDelivery[] })[];
  events: string[];
  rateLimit: number;
}) {
  return (
    <div className="space-y-6">
      <ApiKeysCard keys={keys} rateLimit={rateLimit} />
      <WebhooksCard webhooks={webhooks} events={events} />
    </div>
  );
}
