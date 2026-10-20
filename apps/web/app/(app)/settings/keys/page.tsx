import { PROVIDER_CAPABILITIES, type ApiKeyInfo, type ProviderCapability } from "@shortloop/contracts";
import { Lock, Sparkles } from "lucide-react";
import { ApiKeys } from "../../../../src/components/api-keys";
import { ProviderRoutingForm, type RoutingJob } from "../../../../src/components/provider-routing";
import { Card } from "../../../../src/components/ui";
import { PROVIDER_NAME } from "../../../../src/lib/provider-meta";
import { mcpResource, requireUser } from "../../../../src/server/auth";
import { getRouting, listKeys, shortloopAllowance } from "../../../../src/server/keys";
import { capabilities } from "../../../../src/server/projects";

const name = (id?: string) => (id ? (PROVIDER_NAME[id] ?? id) : undefined);
const own = (id: string) => `${name(id)} · your key`;

const FREE_LABEL = { image: "Free AI images (Pollinations)", tts: "Free built-in voices" } as const;
const SHORTLOOP_LABEL = "ShortLoop AI (in your plan)";
const PREMIUM_LABEL = "ShortLoop premium images (1 AI-video credit per Short)";

/** A user-facing label for a routing choice. */
function choiceLabel(job: "llm" | "image" | "tts", choice?: string): string | undefined {
  if (!choice) return undefined;
  if (choice === "free") return job === "llm" ? undefined : FREE_LABEL[job];
  if (choice === "shortloop") return SHORTLOOP_LABEL;
  if (choice === "shortloop_premium") return PREMIUM_LABEL;
  return own(choice);
}

const canDo = (k: ApiKeyInfo, cap: ProviderCapability) =>
  PROVIDER_CAPABILITIES[k.provider].includes(cap) && !k.unavailable.some((u) => u.capability === cap);

export default async function KeysPage() {
  const user = await requireUser();
  const [keys, caps, routing, allowance] = await Promise.all([
    listKeys(user.id),
    capabilities(user.id),
    getRouting(user.id),
    shortloopAllowance(user.id),
  ]);
  const managed = Boolean(allowance.tier && allowance.enabled);
  const ownOptions = (cap: ProviderCapability) =>
    keys
      .filter((k) => canDo(k, cap) && k.provider !== "pexels" && k.provider !== "pixabay")
      .map((k) => ({
        value: k.provider,
        label: own(k.provider),
      }));
  const shortloop = (job: "llm" | "image" | "tts") =>
    managed && allowance.jobs[job] ? [{ value: "shortloop", label: SHORTLOOP_LABEL }] : [];
  const jobs: RoutingJob[] = [
    {
      id: "llm",
      label: "Scripts",
      automatic: choiceLabel("llm", caps.route.llm) ?? "none: add a key",
      options: [...shortloop("llm"), ...ownOptions("llm")],
    },
    {
      id: "image",
      label: "Images",
      automatic: choiceLabel("image", caps.route.image) ?? FREE_LABEL.image,
      options: [
        { value: "free", label: FREE_LABEL.image },
        ...shortloop("image"),
        ...(managed && allowance.jobs.premiumImage
          ? [{ value: "shortloop_premium", label: PREMIUM_LABEL }]
          : []),
        ...ownOptions("image"),
      ],
      hint: keys.some((k) => k.unavailable.some((u) => u.capability === "image"))
        ? "A key that can't make images isn't offered here; see its card below."
        : undefined,
    },
    {
      id: "tts",
      label: "Voice",
      automatic: choiceLabel("tts", caps.route.tts) ?? FREE_LABEL.tts,
      options: [{ value: "free", label: FREE_LABEL.tts }, ...shortloop("tts"), ...ownOptions("tts")],
    },
  ];
  const stock = keys
    .filter((k) => k.provider === "pexels" || k.provider === "pixabay")
    .map((k) => k.provider);
  const shared = (id?: string) => (id ? `${name(id)} · provided by ShortLoop` : undefined);
  const rows: [string, string | undefined, string][] = [
    [
      "Scripts",
      choiceLabel("llm", caps.route.llm) ?? (caps.aiScripts ? shared(caps.llmProvider) : undefined),
      "Add a Gemini, Claude or OpenAI key, or write scripts yourself",
    ],
    ["Images", choiceLabel("image", caps.route.image) ?? name(caps.image), ""],
    ["Voice", choiceLabel("tts", caps.route.tts) ?? name(caps.voices[0]?.provider), ""],
    [
      "Stock footage",
      stock.length ? stock.map(own).join(", ") : caps.stock.map(shared).join(", ") || undefined,
      "Optional: add Pexels or Pixabay",
    ],
  ];
  const usedPct =
    allowance.limitUsd && allowance.limitUsd > 0
      ? Math.min(100, Math.round((allowance.usedUsd / allowance.limitUsd) * 100))
      : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {managed
            ? "Your plan includes ShortLoop AI. You can also use your own AI accounts for any job and pay those providers directly."
            : "ShortLoop uses your own AI accounts, so you pay providers directly at their prices and stay in control."}
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
      {managed && (
        <Card data-testid="shortloop-allowance">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-brand" aria-hidden /> ShortLoop AI this month
          </h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper">
            <div className="h-full bg-brand" style={{ width: `${usedPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {usedPct}% of this month’s allowance used. When it runs out, images and voices switch to the free
            ones until next month (or use your own keys below).
          </p>
        </Card>
      )}
      <ProviderRoutingForm jobs={jobs} initial={routing} />
      <ApiKeys initial={keys} />
      <Card data-testid="mcp-card">
        <h2 className="font-semibold">Use ShortLoop from Claude, ChatGPT or Cursor</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Add ShortLoop as a custom connector (MCP server) with this URL. You’ll sign in and approve access
          once; then ask your assistant to make, review and publish Shorts. It can only publish what you
          approve.
        </p>
        <code className="mt-3 block select-all rounded-lg bg-paper px-3 py-2 text-sm" data-testid="mcp-url">
          {mcpResource()}
        </code>
      </Card>
    </div>
  );
}
