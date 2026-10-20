"use client";
import {
  Check,
  Download,
  FileText,
  ImagePlus,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  aiScriptAction,
  alternativesAction,
  approveAction,
  publishAction,
  captionsAction,
  produceAction,
  saveScriptAction,
  swapAction,
} from "../../app/(app)/actions";
import type { StockResult } from "@shortloop/providers";
import { CAPTION_STYLES } from "../lib/captions";
import { cn } from "../lib/cn";
import type { LibraryItem } from "../server/library";
import type { capabilities, projectView } from "../server/projects";
import { Badge, Button, Card, ErrorText, Input, Label, Progress, Select, STATUS_LABEL, Textarea } from "./ui";

type View = Awaited<ReturnType<typeof projectView>>;
type Caps = Awaited<ReturnType<typeof capabilities>>;

const IMAGE_STYLES = ["photoreal", "cinematic", "3d", "hand-drawn", "whiteboard", "storyboard", "anime"];
const STAGE_LABELS = ["Writing script", "Recording voiceover", "Finding visuals", "Rendering video"];

type Beat = { text: string; visualQuery: string };

const words = (s: string) => s.match(/\S+/g)?.length ?? 0;

export function Studio({
  initial,
  caps,
  creditsLeft,
  unlimited = false,
  library,
}: {
  initial: View;
  caps: Caps;
  creditsLeft: number;
  unlimited?: boolean;
  library: LibraryItem[];
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const p = view.project;
  const busy = p.status === "scripting" || p.status === "producing";
  const publishing = view.publishes.some((x) => x.status === "queued" || x.status === "uploading");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${p.id}`, { cache: "no-store" });
    if (res.ok) setView((await res.json()) as View);
  }, [p.id]);

  useEffect(() => {
    if (!busy && !publishing) return;
    const t = setInterval(() => void refresh(), busy ? 1500 : 3000);
    return () => clearInterval(t);
  }, [busy, publishing, refresh]);

  const status = STATUS_LABEL[p.status] ?? { label: p.status, tone: "neutral" as const };
  const hasVideo = Boolean(view.videoUrl) && (p.status === "ready" || p.status === "approved");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge tone={status.tone}>{status.label}</Badge>
          <h1 className="mt-2 text-2xl font-bold tracking-tight" data-testid="project-title">
            {p.title}
          </h1>
          {p.topic && p.topic !== p.title && <p className="mt-1 text-sm text-ink-soft">{p.topic}</p>}
        </div>
        <Steps status={p.status} hasScript={Boolean(view.script)} />
      </div>

      {busy && <BusyPanel view={view} />}
      {p.status === "failed" && (
        <Card className="border-bad/30 bg-bad/5" data-testid="failed">
          <h2 className="font-semibold text-bad">Something went wrong</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {p.error ?? "The job failed."} Any credit used has been refunded.
          </p>
        </Card>
      )}

      {p.notices.length > 0 && (
        <Card className="border-warn/30 bg-warn/5" data-testid="notices">
          <h2 className="font-semibold">Good to know about this Short</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {p.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Card>
      )}

      {!busy && !hasVideo && (
        <>
          <ScriptPanel view={view} caps={caps} onChanged={refresh} />
          {view.script && (
            <StylePanel
              view={view}
              caps={caps}
              creditsLeft={creditsLeft}
              unlimited={unlimited}
              library={library}
              onStarted={async () => {
                await refresh();
                router.refresh();
              }}
            />
          )}
        </>
      )}

      {hasVideo && <Review view={view} onChanged={refresh} />}
    </div>
  );
}

function Steps({ status, hasScript }: { status: string; hasScript: boolean }) {
  const steps = ["Idea", "Script", "Style", "Video", "Approve"];
  const reached =
    status === "approved"
      ? 5
      : status === "ready"
        ? 4
        : status === "producing"
          ? 3
          : hasScript
            ? 2
            : status === "scripting"
              ? 1
              : 1;
  return (
    <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full",
              i < reached
                ? "bg-brand text-white"
                : i === reached
                  ? "bg-brand-soft text-brand-deep"
                  : "bg-white text-ink-soft ring-1 ring-line",
            )}
          >
            {i < reached ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={i <= reached ? "text-ink" : "text-ink-soft"}>{s}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function BusyPanel({ view }: { view: View }) {
  const stage = Math.max(0, view.stageIndex);
  const progress = view.job
    ? (stage + (view.job.progress ?? 0)) / (view.project.status === "scripting" ? 1 : 4)
    : 0.05;
  return (
    <Card data-testid="busy">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-semibold">{STAGE_LABELS[stage] ?? "Working"}…</span>
        <span className="text-ink-soft">{Math.round(Math.min(1, progress) * 100)}%</span>
      </div>
      <Progress value={Math.min(1, progress)} />
      <p className="mt-3 text-sm text-ink-soft">
        You can leave this page. We’ll keep going in the background.
      </p>
    </Card>
  );
}

function ScriptPanel({ view, caps, onChanged }: { view: View; caps: Caps; onChanged: () => Promise<void> }) {
  const s = view.script;
  const [editing, setEditing] = useState<boolean>(!s && view.project.status === "draft" ? false : !s);
  const [title, setTitle] = useState(s?.title ?? view.project.title);
  const [beats, setBeats] = useState<Beat[]>(
    s?.beats.map((b) => ({ text: b.text, visualQuery: b.visualQuery })) ?? [],
  );
  const [cta, setCta] = useState(s?.cta ?? "Follow for more.");
  const [error, setError] = useState<string>();
  const [variation, setVariation] = useState<string[]>();
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (s) {
      setTitle(s.title);
      setBeats(s.beats.map((b) => ({ text: b.text, visualQuery: b.visualQuery })));
      setCta(s.cta);
    }
  }, [s]);

  const total = useMemo(() => beats.reduce((n, b) => n + words(b.text), 0) + words(cta), [beats, cta]);
  const target = view.targetWords;
  const inRange = Math.abs(total - target) <= target * 0.15;

  async function askAi() {
    setAsking(true);
    setError(undefined);
    const r = await aiScriptAction(view.project.id);
    setAsking(false);
    if (!r.ok) setError(r.error);
    await onChanged();
  }

  async function save(override = false) {
    setSaving(true);
    setError(undefined);
    const r = await saveScriptAction(view.project.id, { title, beats, cta }, override);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    if (!r.data.ok) {
      if (r.data.variation?.length) return setVariation(r.data.variation);
      return setError(r.data.problems.join(" "));
    }
    setVariation(undefined);
    setEditing(false);
    await onChanged();
  }

  if (!s && !editing) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Script</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Start from an AI draft or write it yourself. Either way, you can edit every line.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={askAi} loading={asking} disabled={!caps.aiScripts} data-testid="ai-script">
            <Sparkles className="size-4" aria-hidden /> Write it with AI
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setBeats([
                { text: "", visualQuery: "" },
                { text: "", visualQuery: "" },
                { text: "", visualQuery: "" },
              ]);
              setEditing(true);
            }}
          >
            <FileText className="size-4" aria-hidden /> I’ll write it
          </Button>
        </div>
        {!caps.aiScripts && (
          <p className="mt-3 text-xs text-ink-soft" data-testid="needs-key">
            AI scripts use your own AI key.{" "}
            <a href="/settings/keys" className="font-semibold text-brand">
              Add a Gemini, Claude or OpenAI key
            </a>{" "}
            (Gemini has a free tier), or write it yourself.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  }

  return (
    <Card data-testid="script-editor">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Script</h2>
        <span
          className={cn("text-xs font-semibold", inRange ? "text-good" : "text-warn")}
          data-testid="word-count"
        >
          {total} / {target} words
        </span>
      </div>
      {!editing && s ? (
        <div className="space-y-3">
          <ol className="space-y-2">
            {s.beats.map((b, i) => (
              <li key={b.id} className="rounded-lg bg-paper p-3 text-sm">
                <span className="mr-2 font-semibold text-brand">{i + 1}</span>
                {b.text}
                <div className="mt-1 text-xs text-ink-soft">Visual: {b.visualQuery}</div>
              </li>
            ))}
          </ol>
          {s.cta && <p className="text-sm text-ink-soft">CTA: {s.cta}</p>}
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit script
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          </div>
          <p className="text-xs text-ink-soft">
            Beat 1 opens with your hook: the first sentence is what stops the scroll.
          </p>
          {beats.map((b, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-brand">Beat {i + 1}</span>
                <button
                  type="button"
                  className="text-ink-soft hover:text-bad disabled:opacity-30"
                  disabled={beats.length <= 2}
                  onClick={() => setBeats(beats.filter((_, j) => j !== i))}
                  aria-label={`Remove beat ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Textarea
                aria-label={`Beat ${i + 1} narration`}
                value={b.text}
                placeholder={i === 0 ? "Hook: why do octopuses need three hearts?" : "What the voice says"}
                onChange={(e) =>
                  setBeats(beats.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <Input
                className="mt-2"
                aria-label={`Beat ${i + 1} visual`}
                value={b.visualQuery}
                placeholder="What to show: an octopus close up on a reef"
                onChange={(e) =>
                  setBeats(beats.map((x, j) => (j === i ? { ...x, visualQuery: e.target.value } : x)))
                }
              />
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => setBeats([...beats, { text: "", visualQuery: "" }])}
            disabled={beats.length >= 12}
          >
            <Plus className="size-4" aria-hidden /> Add beat
          </Button>
          <div>
            <Label htmlFor="cta">Call to action</Label>
            <Input id="cta" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={200} />
          </div>
          {variation && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm" role="alert">
              <p className="font-semibold text-warn">This looks a lot like one of your recent Shorts</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {variation.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <p className="mt-2 text-ink-soft">
                Near-duplicates can get a channel demonetised. Change the angle, or save anyway (we’ll log
                it).
              </p>
              <Button className="mt-3" variant="secondary" onClick={() => void save(true)} loading={saving}>
                Save anyway
              </Button>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            {s && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={() => void save(false)} loading={saving} data-testid="save-script">
              Save script
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function StylePanel({
  view,
  caps,
  creditsLeft,
  unlimited,
  library,
  onStarted,
}: {
  view: View;
  caps: Caps;
  creditsLeft: number;
  unlimited: boolean;
  library: LibraryItem[];
  onStarted: () => Promise<void>;
}) {
  const visualsLib = library.filter((a) => a.kind !== "audio");
  const [picked, setPicked] = useState<string[]>([]);
  const settings = view.project.settings;
  const [voiceId, setVoiceId] = useState(settings.voiceId ?? caps.voices[0]?.id ?? "");
  const [captionStyle, setCaptionStyle] = useState(settings.captionStyle ?? "bold-pop");
  const [imageStyle, setImageStyle] = useState(settings.imageStyle ?? "cinematic");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    setError(undefined);
    const r = await produceAction(view.project.id, {
      voiceId,
      captionStyle: captionStyle as (typeof CAPTION_STYLES)[number]["id"],
      imageStyle,
      libraryAssetIds: picked,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    await onStarted();
  }

  return (
    <Card data-testid="style-panel">
      <h2 className="text-lg font-semibold">Voice and look</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="voice">Voice</Label>
          <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {caps.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="imageStyle">Visual style (for AI images)</Label>
          <Select id="imageStyle" value={imageStyle} onChange={(e) => setImageStyle(e.target.value)}>
            {IMAGE_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Captions</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CAPTION_STYLES.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => setCaptionStyle(c.id)}
              aria-pressed={captionStyle === c.id}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                captionStyle === c.id ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40",
              )}
            >
              <span className="block text-sm font-semibold">{c.label}</span>
              <span className="block text-xs text-ink-soft">{c.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {visualsLib.length > 0 && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium">Use my footage (optional)</legend>
          <p className="mb-2 text-xs text-ink-soft">
            Picked items are used on beats whose visual matches their file name.
          </p>
          <div className="flex flex-wrap gap-2">
            {visualsLib.map((a) => (
              <label
                key={a.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-xs",
                  picked.includes(a.id) ? "border-brand bg-brand-soft" : "border-line",
                )}
              >
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={picked.includes(a.id)}
                  onChange={(e) =>
                    setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))
                  }
                />
                {a.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-ink-soft">
          {unlimited ? (
            <>
              <strong className="text-ink">Unlimited Shorts</strong> (beta access)
            </>
          ) : (
            <>
              Uses <strong className="text-ink">1 Short credit</strong> · you have {creditsLeft}
            </>
          )}
          {caps.stock.length === 0 && " · visuals will be AI-generated (no stock library connected)"}
        </p>
        <Button
          onClick={go}
          loading={loading}
          disabled={(!unlimited && creditsLeft < 1) || !voiceId}
          data-testid="make-short"
        >
          <Wand2 className="size-4" aria-hidden /> Make my Short
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function Review({ view, onChanged }: { view: View; onChanged: () => Promise<void> }) {
  const p = view.project;
  const [error, setError] = useState<string>();
  const [approving, setApproving] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-[var(--radius-card)] bg-ink shadow-lg">
          <video
            data-testid="player"
            className="aspect-[9/16] w-full"
            src={view.videoUrl}
            poster={view.thumbUrl}
            controls
            playsInline
            preload="metadata"
          />
        </div>
        <div className="flex gap-2">
          <a
            href={view.videoUrl}
            download
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:bg-paper"
          >
            <Download className="size-4" aria-hidden /> Download
          </a>
          {p.status === "approved" ? (
            <span
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-good/10 px-4 py-2.5 text-sm font-semibold text-good"
              data-testid="approved"
            >
              <ShieldCheck className="size-4" aria-hidden /> Approved
            </span>
          ) : (
            <Button
              className="flex-1"
              data-testid="approve"
              disabled={!view.publishable.ok}
              title={view.publishable.ok ? "" : view.publishable.problems.join(" ")}
              loading={approving}
              onClick={async () => {
                setApproving(true);
                const r = await approveAction(p.id);
                setApproving(false);
                if (!r.ok) setError(r.error);
                await onChanged();
              }}
            >
              <Check className="size-4" aria-hidden /> Approve
            </Button>
          )}
        </div>
        {!view.publishable.ok && <ErrorText>{view.publishable.problems.join(" ")}</ErrorText>}
        <ErrorText>{error}</ErrorText>
        {p.status === "approved" && <PublishPanel view={view} onChanged={onChanged} />}
      </div>
      <div className="space-y-6">
        <VisualsEditor view={view} onChanged={onChanged} />
        <CaptionsEditor view={view} onChanged={onChanged} />
        <RightsPanel view={view} />
      </div>
    </div>
  );
}

function VisualsEditor({ view, onChanged }: { view: View; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState<number>();
  const [alts, setAlts] = useState<StockResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function show(i: number) {
    setOpen(i);
    setAlts([]);
    setLoading(true);
    const r = await alternativesAction(view.project.id, i);
    setLoading(false);
    if (r.ok) setAlts(r.data.stock);
    else setError(r.error);
  }
  async function swap(i: number, choice: { kind: "stock"; result: StockResult } | { kind: "ai" }) {
    setLoading(true);
    const r = await swapAction(view.project.id, i, choice);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setOpen(undefined);
    await onChanged();
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Visuals</h2>
      <p className="mt-1 text-sm text-ink-soft">Don’t like a shot? Swap it. Re-renders are free.</p>
      <ul className="mt-4 space-y-3">
        {view.beatsVisuals.map((b, i) => (
          <li key={`${b.beatId}-${i}`} className="flex gap-3 rounded-lg border border-line p-3">
            <div className="aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-md bg-paper">
              {b.previewUrl ? (
                <img src={b.previewUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-[10px] text-ink-soft">
                  video
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm">{b.text || `Shot ${i + 1}`}</p>
              <Badge tone="neutral">{b.source.replace("_", " ")}</Badge>
            </div>
            <Button
              variant="secondary"
              className="self-center"
              onClick={() => void show(i)}
              aria-label={`Swap visual ${i + 1}`}
            >
              <RefreshCcw className="size-4" aria-hidden /> Swap
            </Button>
          </li>
        ))}
      </ul>
      {open !== undefined && (
        <div className="mt-4 rounded-lg bg-paper p-3" data-testid="alternatives">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Alternatives for shot {open + 1}</span>
            <Button variant="ghost" onClick={() => setOpen(undefined)}>
              Close
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {alts.map((a) => (
              <button
                key={`${a.provider}-${a.providerId}`}
                onClick={() => void swap(open, { kind: "stock", result: a })}
                className="overflow-hidden rounded-md ring-brand hover:ring-2"
                title={a.attribution}
              >
                <img src={a.previewUrl} alt={a.attribution} className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
            <button
              onClick={() => void swap(open, { kind: "ai" })}
              className="flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-brand/40 text-xs font-semibold text-brand hover:bg-brand-soft"
              data-testid="swap-ai"
            >
              <ImagePlus className="size-5" aria-hidden /> New AI image
            </button>
          </div>
          {loading && <p className="mt-2 text-xs text-ink-soft">Working…</p>}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function CaptionsEditor({ view, onChanged }: { view: View; onChanged: () => Promise<void> }) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const changed = Object.keys(edits).length > 0;
  return (
    <Card>
      <h2 className="text-lg font-semibold">Captions</h2>
      <p className="mt-1 text-sm text-ink-soft">Fix a misheard word or a name. Click a word to edit it.</p>
      <div className="mt-4 flex flex-wrap gap-1.5" data-testid="caption-words">
        {view.captions.map((w, i) => (
          <input
            key={i}
            aria-label={`Caption word ${i + 1}`}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-sm",
              edits[i] !== undefined
                ? "border-brand bg-brand-soft"
                : w.emphasis
                  ? "border-warn/40 bg-warn/5"
                  : "border-line bg-white",
            )}
            style={{ width: `calc(${Math.max(2, (edits[i] ?? w.text).length)}ch + 1.25rem)` }}
            value={edits[i] ?? w.text}
            onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
          />
        ))}
      </div>
      {changed && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEdits({})}>
            Reset
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const r = await captionsAction(
                view.project.id,
                Object.entries(edits).map(([index, text]) => ({ index: Number(index), text })),
              );
              setSaving(false);
              if (!r.ok) return setError(r.error);
              setEdits({});
              await onChanged();
            }}
          >
            Apply and re-render
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function RightsPanel({ view }: { view: View }) {
  if (!view.manifest) return null;
  return (
    <Card data-testid="rights">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="size-5 text-good" aria-hidden /> Rights manifest
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Where every piece of this Short came from. Attributions are added to the description when you publish.
      </p>
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-xs text-ink-soft">
          <tr>
            <th className="pb-2 font-medium">Asset</th>
            <th className="pb-2 font-medium">Source</th>
            <th className="pb-2 font-medium">Licence</th>
          </tr>
        </thead>
        <tbody>
          {view.manifest.entries.map((e) => (
            <tr key={e.assetId} className="border-t border-line align-top">
              <td className="py-2 pr-2">
                {e.kind} <span className="text-xs text-ink-soft">({e.usedOn.join(", ")})</span>
              </td>
              <td className="py-2 pr-2">{e.source.replace("_", " ")}</td>
              <td className="py-2 text-ink-soft">
                {e.licence?.type ?? "missing"}
                {e.licence?.provider ? ` · ${e.licence.provider}` : ""}
                {e.attribution ? <div className="text-xs">{e.attribution}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const PUBLISH_STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "good" | "warn" | "bad" }> =
  {
    queued: { label: "Queued", tone: "neutral" },
    uploading: { label: "Uploading…", tone: "brand" },
    published: { label: "Published", tone: "good" },
    scheduled: { label: "Scheduled", tone: "good" },
    scheduled_next_window: { label: "Waiting for YouTube's daily limit to reset", tone: "warn" },
    failed: { label: "Failed", tone: "bad" },
  };

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

function PublishPanel({ view, onChanged }: { view: View; onChanged: () => Promise<void> }) {
  const done = new Set(view.publishes.filter((x) => x.status !== "failed").map((x) => x.channelId));
  const connected = view.channels.filter((c) => c.status === "connected");
  const available = connected.filter((c) => !done.has(c.id));
  const [channelId, setChannelId] = useState(available[0]?.id ?? "");
  useEffect(() => {
    if (!available.some((c) => c.id === channelId)) setChannelId(available[0]?.id ?? "");
  }, [available, channelId]);
  const [title, setTitle] = useState((view.script?.title ?? view.project.title).slice(0, 100));
  const [description, setDescription] = useState(
    view.script ? `${view.script.hook}\n\n${view.script.cta}` : "",
  );
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [schedule, setSchedule] = useState(false);
  const [at, setAt] = useState("");
  const [ai, setAi] = useState(view.aiDisclosureRequired);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    setError(undefined);
    const r = await publishAction(view.project.id, {
      channelId,
      title,
      description,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      privacy,
      scheduledAt: schedule && at ? new Date(at).toISOString() : undefined,
      aiDisclosure: ai || view.aiDisclosureRequired,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    await onChanged();
  }

  return (
    <Card className="mt-2" data-testid="publish-panel">
      <h2 className="text-lg font-semibold">Publish to YouTube</h2>
      {view.publishes.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="publishes">
          {view.publishes.map((x) => {
            const s = PUBLISH_STATUS[x.status] ?? { label: x.status, tone: "neutral" as const };
            return (
              <li key={x.id} className="rounded-lg bg-paper p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{x.channelTitle}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                {x.url && (
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-brand"
                    data-testid="published-link"
                  >
                    {x.status === "scheduled" ? `Goes live ${when(x.scheduledAt)}` : "View on YouTube"}
                  </a>
                )}
                {x.status === "scheduled_next_window" && (
                  <p className="mt-1 text-xs text-ink-soft">
                    We’ll upload it automatically after {when(x.retryAt)}.
                  </p>
                )}
                {x.error && <p className="mt-1 text-xs text-bad">{x.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {connected.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft" data-testid="no-channel-hint">
          <a href="/channels" className="font-semibold text-brand">
            Connect a YouTube channel
          </a>{" "}
          to publish this Short.
        </p>
      ) : available.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft" data-testid="all-published">
          Published to all your connected channels.{" "}
          <a href="/channels" className="font-semibold text-brand">
            Add another channel
          </a>
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="pub-channel">Channel</Label>
            <Select id="pub-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="pub-title">Title</Label>
            <Input id="pub-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pub-desc">Description</Label>
            <Textarea
              id="pub-desc"
              value={description}
              maxLength={4500}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-soft">
              #Shorts and credits for stock media are added for you.
            </p>
          </div>
          <div>
            <Label htmlFor="pub-tags">Tags (comma separated)</Label>
            <Input
              id="pub-tags"
              value={tags}
              placeholder="octopus, ocean facts"
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pub-privacy">Visibility</Label>
              <Select
                id="pub-privacy"
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
                disabled={schedule}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={schedule}
                  onChange={(e) => setSchedule(e.target.checked)}
                />{" "}
                Schedule
              </label>
              {schedule && (
                <Input
                  type="datetime-local"
                  aria-label="Publish at"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                />
              )}
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand"
              checked={ai || view.aiDisclosureRequired}
              disabled={view.aiDisclosureRequired}
              onChange={(e) => setAi(e.target.checked)}
              data-testid="ai-disclosure"
            />
            <span>
              Label as altered or synthetic content
              <span className="block text-xs text-ink-soft">
                {view.aiDisclosureRequired
                  ? "Required: this Short uses realistic AI images or an AI voice that could pass for a real person."
                  : "Optional for this Short. Turn on if viewers could mistake anything for real footage."}
              </span>
            </span>
          </label>
          <ErrorText>{error}</ErrorText>
          <Button
            className="w-full"
            onClick={() => void go()}
            loading={loading}
            disabled={!channelId || !title.trim() || (schedule && !at)}
            data-testid="publish"
          >
            {schedule ? "Schedule on YouTube" : "Publish to YouTube"}
          </Button>
        </div>
      )}
    </Card>
  );
}
