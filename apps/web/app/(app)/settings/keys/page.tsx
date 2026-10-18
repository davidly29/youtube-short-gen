import type { ApiKeyInfo } from "@shortloop/contracts";
import { Lock } from "lucide-react";
import { ApiKeys } from "../../../../src/components/api-keys";
import { Card } from "../../../../src/components/ui";
import { PROVIDER_NAME } from "../../../../src/lib/provider-meta";
import { requireUser } from "../../../../src/server/auth";
import { listKeys } from "../../../../src/server/keys";
import { capabilities } from "../../../../src/server/projects";

const name = (id?: string) => (id ? (PROVIDER_NAME[id] ?? id) : undefined);
const own = (id: string) => `${name(id)} · your key`;

/** Same rule as the worker: the most recently saved key for a job wins. */
function newest(keys: ApiKeyInfo[], among: string[]) {
  return keys
    .filter((k) => among.includes(k.provider))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.provider;
}

export default async function KeysPage() {
  const user = await requireUser();
  const [keys, caps] = await Promise.all([listKeys(user.id), capabilities(user.id)]);
  const llm = newest(keys, ["anthropic", "openai", "gemini"]);
  const image = newest(keys, ["fal", "gemini"]);
  const voice = keys.some((k) => k.provider === "elevenlabs") ? "elevenlabs" : undefined;
  const stock = keys
    .filter((k) => k.provider === "pexels" || k.provider === "pixabay")
    .map((k) => k.provider);
  const shared = (id?: string) => (id ? `${name(id)} · provided by ShortLoop` : undefined);
  const rows: [string, string | undefined, string][] = [
    [
      "Scripts",
      llm ? own(llm) : caps.aiScripts ? shared(caps.llmProvider) : undefined,
      "Add a Gemini, Claude or OpenAI key, or write scripts yourself",
    ],
    ["Images", image ? own(image) : name(caps.image), ""],
    ["Voice", voice ? own(voice) : name(caps.voices[0]?.provider), ""],
    [
      "Stock footage",
      stock.length ? stock.map(own).join(", ") : caps.stock.map(shared).join(", ") || undefined,
      "Optional: add Pexels or Pixabay",
    ],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-ink-soft">
          ShortLoop uses your own AI accounts, so you pay providers directly at their prices and stay in
          control.
        </p>
      </div>
      <Card data-testid="in-use">
        <h2 className="text-sm font-semibold">What your Shorts use now</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value, hint]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-28 shrink-0 text-ink-soft">{label}</dt>
              <dd className={value ? "font-medium" : "text-ink-soft"}>{value ?? hint}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Keys are encrypted before they’re stored, never shown again in full, and only used to make your
          Shorts. Remove one any time.
        </p>
      </Card>
      <ApiKeys initial={keys} />
    </div>
  );
}
