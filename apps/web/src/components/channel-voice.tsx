"use client";
import type { ChannelStyle } from "@shortloop/contracts";
import { RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildVoiceAction, saveVoiceAction, toggleVoiceAction } from "../../app/(app)/settings/voice/actions";
import { Button, Card, ErrorText, Input, Label, Textarea } from "./ui";

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Build, review and edit one channel's voice profile (E4-03). */
export function ChannelVoiceEditor({
  channel,
  style,
}: {
  channel: { id: string; title: string; status: string };
  style?: ChannelStyle;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"build" | "save" | "toggle">();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  // Optimistic: the box flips at once and flips back if saving fails.
  const [enabled, setEnabled] = useState(style?.enabled ?? false);
  const id = (f: string) => `voice-${channel.id}-${f}`;

  async function act(kind: "build" | "save" | "toggle", fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(kind);
    setError(undefined);
    setSaved(false);
    const res = await fn();
    setBusy(undefined);
    if (!res.ok) setError(res.error);
    else {
      if (kind === "save") setSaved(true);
      router.refresh();
    }
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    void act("save", () =>
      saveVoiceAction(channel.id, {
        vocabulary: get("vocabulary"),
        sentenceLength: get("sentenceLength"),
        hookPatterns: get("hookPatterns"),
        bannedPhrases: get("bannedPhrases"),
        examples: get("examples"),
      }),
    );
  }

  return (
    <Card data-testid={`voice-${channel.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{channel.title}</h2>
          <p className="mt-1 text-sm text-ink-soft" data-testid="voice-status">
            {style
              ? `Learned from ${style.sourceVideoCount} of your videos on ${date(style.builtAt)}${style.editedAt ? `, edited ${date(style.editedAt)}` : ""}.`
              : "Not learned yet."}
          </p>
        </div>
        <Button
          type="button"
          variant={style ? "secondary" : "primary"}
          loading={busy === "build"}
          disabled={channel.status !== "connected"}
          onClick={() => void act("build", () => buildVoiceAction(channel.id))}
          data-testid="build-voice"
          title={
            style ? "Re-read your latest videos. Replaces your edits, keeps your banned phrases." : undefined
          }
        >
          {style ? <RefreshCw className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {style ? "Relearn from my videos" : "Learn my voice"}
        </Button>
      </div>
      {channel.status !== "connected" && (
        <p className="mt-2 text-sm text-ink-soft">
          Reconnect this channel on Channels to (re)learn its voice.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {style && (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy === "toggle"}
              onChange={(e) => {
                const next = e.target.checked;
                setEnabled(next);
                void act("toggle", async () => {
                  const res = await toggleVoiceAction(channel.id, next);
                  if (!res.ok) setEnabled(!next);
                  return res;
                });
              }}
              data-testid="voice-enabled"
            />
            Write new scripts in this voice
          </label>
          {/* key: re-mount the form with the stored values after a rebuild */}
          <form key={`${style.builtAt}-${style.editedAt ?? ""}`} className="mt-4 space-y-4" onSubmit={onSave}>
            <div>
              <Label htmlFor={id("vocabulary")}>Words you use (comma or one per line)</Label>
              <Textarea
                id={id("vocabulary")}
                name="vocabulary"
                defaultValue={style.profile.vocabulary.join(", ")}
              />
            </div>
            <div className="max-w-48">
              <Label htmlFor={id("sentenceLength")}>Average sentence length (words)</Label>
              <Input
                id={id("sentenceLength")}
                name="sentenceLength"
                type="number"
                min={3}
                max={40}
                step={0.1}
                defaultValue={style.profile.sentenceLength}
              />
            </div>
            <div>
              <Label htmlFor={id("hookPatterns")}>How your hooks open (one per line)</Label>
              <Textarea
                id={id("hookPatterns")}
                name="hookPatterns"
                defaultValue={style.profile.hookPatterns.join("\n")}
              />
            </div>
            <div>
              <Label htmlFor={id("bannedPhrases")}>Never say (one per line)</Label>
              <Textarea
                id={id("bannedPhrases")}
                name="bannedPhrases"
                defaultValue={style.profile.bannedPhrases.join("\n")}
                data-testid="voice-banned"
              />
            </div>
            <div>
              <Label htmlFor={id("examples")}>Your titles, for tone (one per line)</Label>
              <Textarea
                id={id("examples")}
                name="examples"
                defaultValue={style.profile.examples.join("\n")}
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span className="text-sm font-medium text-good" data-testid="voice-saved">
                  Saved
                </span>
              )}
              <Button type="submit" loading={busy === "save"} data-testid="save-voice">
                Save voice
              </Button>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}
