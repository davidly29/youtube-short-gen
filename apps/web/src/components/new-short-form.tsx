"use client";
import {
  ArrowRight,
  Lightbulb,
  ListOrdered,
  Newspaper,
  Scale,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectAction, quickCreateAction } from "../../app/(app)/actions";
import { CAPTION_STYLES } from "../lib/captions";
import { cn } from "../lib/cn";
import { Button, Card, ErrorText, Input, Label, Select, Textarea } from "./ui";

const LENGTHS = [30, 45, 60] as const;
const TONES = ["curious", "energetic", "calm", "funny", "dramatic", "authoritative"];
const IMAGE_STYLES = ["cinematic", "photoreal", "3d", "hand-drawn", "whiteboard", "storyboard", "anime"];

/** The four Short formats (same slugs as the MCP playbooks). Picking one sets the angle. */
const FORMATS = [
  {
    id: "trend-explainer",
    label: "Trend explainer",
    icon: TrendingUp,
    angle: "Explain why this is trending and what it means for the viewer",
  },
  {
    id: "myth-vs-fact",
    label: "Myth vs fact",
    icon: Scale,
    angle: "Bust the most common myth about it, then give the real facts",
  },
  {
    id: "top-3-list",
    label: "Top 3",
    icon: ListOrdered,
    angle: "Count down the three most surprising facts, best one last",
  },
  {
    id: "news-in-60s",
    label: "News in 60s",
    icon: Newspaper,
    angle: "What happened, why it matters, and what happens next",
  },
] as const;

/** Prefill from a daily-brief item ("Make this Short" on /today). */
export interface NewShortDefaults {
  topic?: string;
  angle?: string;
  topicId?: string;
}

/** A ready-made idea from today's brief, offered as a one-click starting point. */
export interface IdeaChip {
  topic: string;
  angle: string;
  topicId: string;
  channel: string;
}

export function NewShortForm({
  defaults = {},
  voices = [],
  narrators = [],
  aiScripts = false,
  ideas = [],
}: {
  defaults?: NewShortDefaults;
  /** Channels whose voice profile is switched on (E4-03); the first is preselected. */
  voices?: { id: string; title: string }[];
  /** Narrator voices this user can use (their own provider's, or the free ones). */
  narrators?: { id: string; label: string }[];
  /** Whether the user's own AI key can write scripts (needed for Quick Short). */
  aiScripts?: boolean;
  ideas?: IdeaChip[];
}) {
  const router = useRouter();
  const [topic, setTopic] = useState(defaults.topic ?? "");
  const [angle, setAngle] = useState(defaults.angle ?? "");
  const [topicId, setTopicId] = useState(defaults.topicId);
  const [format, setFormat] = useState<string>();
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(45);
  const [narrator, setNarrator] = useState(narrators[0]?.id ?? "");
  const [captionStyle, setCaptionStyle] = useState<(typeof CAPTION_STYLES)[number]["id"]>("bold-pop");
  const [imageStyle, setImageStyle] = useState("cinematic");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState<"quick" | "steps">();

  function applyIdea(i: IdeaChip) {
    setTopic(i.topic);
    setAngle(i.angle);
    setTopicId(i.topicId);
    setFormat(undefined);
  }

  function pickFormat(id: string) {
    const f = FORMATS.find((x) => x.id === id);
    if (!f) return;
    const previous = FORMATS.find((x) => x.id === format)?.angle;
    setFormat(f.id === format ? undefined : f.id);
    // Only replace an angle the user hasn't written themselves.
    if (!angle || angle === previous) setAngle(f.id === format ? "" : f.angle);
  }

  async function submit(mode: "quick" | "steps", form: HTMLFormElement) {
    if (!form.reportValidity()) return;
    setLoading(mode);
    setError(undefined);
    const f = new FormData(form);
    const base = {
      topic,
      angle: angle.trim() || undefined,
      targetSeconds: length,
      tone: String(f.get("tone") ?? "curious"),
      // A topic the user retyped is no longer the brief's topic.
      topicId:
        topic === defaults.topic || ideas.some((i) => i.topicId === topicId && i.topic === topic)
          ? topicId
          : undefined,
      styleChannelId: String(f.get("voice") ?? "") || undefined,
    };
    const res =
      mode === "quick"
        ? await quickCreateAction({ ...base, voiceId: narrator, captionStyle, imageStyle })
        : await createProjectAction(base);
    if (!res.ok) {
      setLoading(undefined);
      setError(res.error);
      return;
    }
    router.push(`/projects/${res.data}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-[var(--radius-card)] bg-gradient-to-br from-brand to-brand-deep p-6 text-white shadow-sm">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/80 uppercase">
          <Sparkles className="size-3.5" aria-hidden /> New Short
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">What’s your Short about?</h1>
        <p className="mt-1 text-sm text-white/85">
          A topic is enough. <strong>Make my Short</strong> writes, voices and edits it in one go, or go step
          by step to edit the script first. You always review before anything is published.
        </p>
      </div>

      {ideas.length > 0 && (
        <Card className="p-5" data-testid="idea-chips">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Lightbulb className="size-4 text-brand" aria-hidden /> Ideas from today’s brief
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {ideas.map((i) => (
              <button
                type="button"
                key={i.topicId}
                onClick={() => applyIdea(i)}
                aria-pressed={topicId === i.topicId && topic === i.topic}
                className={cn(
                  "max-w-full truncate rounded-full border px-3 py-1.5 text-left text-sm transition",
                  topicId === i.topicId && topic === i.topic
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-line bg-white hover:border-brand/40",
                )}
                title={`${i.angle} · ${i.channel}`}
              >
                {i.topic}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("steps", e.currentTarget);
          }}
        >
          <div>
            <Label htmlFor="topic">Topic</Label>
            <Textarea
              id="topic"
              name="topic"
              placeholder="Why octopuses have three hearts"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              minLength={3}
              maxLength={300}
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Format (optional)</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="format-cards">
              {FORMATS.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => pickFormat(id)}
                  aria-pressed={format === id}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm font-semibold transition",
                    format === id
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line bg-white hover:border-brand/40",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="angle">Angle (optional)</Label>
            <Input
              id="angle"
              name="angle"
              placeholder="e.g. what happens to the hearts when they swim"
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              maxLength={300}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Length</Label>
              <div className="flex gap-2" role="radiogroup" aria-label="Length">
                {LENGTHS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    role="radio"
                    aria-checked={length === s}
                    onClick={() => setLength(s)}
                    className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${length === s ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-white text-ink-soft hover:border-brand/40"}`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="tone">Tone</Label>
              <Select id="tone" name="tone" defaultValue="curious">
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t[0]?.toUpperCase()}
                    {t.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {voices.length > 0 && (
            <div>
              <Label htmlFor="voice">Write it in the voice of</Label>
              <Select id="voice" name="voice" defaultValue={voices[0]?.id} data-testid="voice-select">
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
                <option value="">No channel voice</option>
              </Select>
            </div>
          )}

          <details className="group rounded-lg border border-line bg-paper/60 p-4" data-testid="quick-style">
            <summary className="cursor-pointer text-sm font-semibold">
              Voice and look <span className="font-normal text-ink-soft">(used by Make my Short)</span>
            </summary>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="narrator">Narrator</Label>
                <Select id="narrator" value={narrator} onChange={(e) => setNarrator(e.target.value)}>
                  {narrators.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="quickImageStyle">Visual style</Label>
                <Select
                  id="quickImageStyle"
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value)}
                >
                  {IMAGE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Caption style">
              {CAPTION_STYLES.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={captionStyle === c.id}
                  onClick={() => setCaptionStyle(c.id)}
                  title={c.hint}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    captionStyle === c.id
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line bg-white text-ink-soft hover:border-brand/40",
                  )}
                >
                  {c.label} captions
                </button>
              ))}
            </div>
          </details>

          <ErrorText>{error}</ErrorText>
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="submit"
              variant="secondary"
              loading={loading === "steps"}
              disabled={Boolean(loading)}
            >
              Continue to script <ArrowRight className="size-4" aria-hidden />
            </Button>
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button
                type="button"
                data-testid="quick-create"
                loading={loading === "quick"}
                disabled={!aiScripts || !narrator || Boolean(loading)}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form) void submit("quick", form);
                }}
              >
                {loading !== "quick" && <Zap className="size-4" aria-hidden />} Make my Short
              </Button>
              {!aiScripts && (
                <p className="text-xs text-ink-soft" data-testid="quick-needs-key">
                  Needs your AI key to write the script.{" "}
                  <Link href="/settings/keys" className="font-semibold text-brand">
                    Add one
                  </Link>{" "}
                  or go step by step.
                </p>
              )}
              {aiScripts && (
                <p className="text-xs text-ink-soft">Uses 1 credit. You review before publishing.</p>
              )}
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
