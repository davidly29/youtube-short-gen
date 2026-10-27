"use client";
import { Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorText, Label, Textarea } from "../../../../src/components/ui";
import { disconnectInstagramAction, postToInstagramAction } from "./actions";
import type { InstagramPublishView } from "./service";

/** Instagram's caption limit (mirrors INSTAGRAM_CAPTION_MAX in the worker; credits are added on top, kept). */
const CAPTION_MAX = 2200;

const STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "good" | "bad" }> = {
  queued: { label: "Queued", tone: "neutral" },
  uploading: { label: "Processing on Instagram…", tone: "brand" },
  scheduled_next_window: { label: "Waiting for Instagram’s limit", tone: "neutral" },
  published: { label: "Posted", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

export function InstagramPostForm(props: {
  projectId: string;
  channel: { id: string; title: string; avatarUrl: string | null };
  defaultCaption: string;
  videoUrl?: string;
  thumbUrl?: string;
  publishes: InstagramPublishView[];
}) {
  const router = useRouter();
  const [caption, setCaption] = useState(props.defaultCaption);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const live = props.publishes.find((p) => p.status !== "failed");
  const inFlight = props.publishes.some((p) => p.status === "queued" || p.status === "uploading");

  // The Reel is processed by a background job: refresh until it settles.
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  async function post() {
    setLoading(true);
    setError(undefined);
    const r = await postToInstagramAction(props.projectId, { caption });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4" data-testid="instagram-account">
        {props.channel.avatarUrl ? (
          // Profile pictures come from Instagram's CDN.
          <img src={props.channel.avatarUrl} alt="" className="size-10 rounded-full" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-paper text-sm font-bold">
            {props.channel.title.replace(/^@/, "").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-soft">Posting to</p>
          <p className="truncate font-semibold" data-testid="instagram-username">
            {props.channel.title}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            const r = await disconnectInstagramAction(props.channel.id);
            if (!r.ok) return setError(r.error);
            router.refresh();
          }}
        >
          <Link2Off className="size-4" aria-hidden /> Disconnect
        </Button>
      </Card>

      {props.publishes.length > 0 && (
        <Card data-testid="instagram-publishes">
          <h2 className="font-semibold">Reels</h2>
          <ul className="mt-3 space-y-2">
            {props.publishes.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
              return (
                <li key={p.id} className="rounded-lg bg-paper p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{props.channel.title}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  {p.status === "uploading" && (
                    <p className="mt-1 text-xs text-ink-soft">
                      Instagram is processing your video. This usually takes a minute or two.
                    </p>
                  )}
                  {p.status === "scheduled_next_window" && p.retryAt && (
                    <p className="mt-1 text-xs text-ink-soft" data-testid="instagram-held">
                      Instagram’s posting limit was reached. We’ll try again automatically after{" "}
                      {new Date(p.retryAt).toLocaleString()}.
                    </p>
                  )}
                  {p.status === "published" && p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs font-semibold text-brand"
                      data-testid="instagram-link"
                    >
                      View on Instagram
                    </a>
                  )}
                  {p.error && <p className="mt-1 text-xs text-bad">{p.error}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!live && (
        <Card data-testid="instagram-form">
          <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
            {props.videoUrl ? (
              <video
                src={props.videoUrl}
                poster={props.thumbUrl}
                controls
                playsInline
                className="aspect-[9/16] w-full rounded-lg bg-black"
                data-testid="instagram-preview"
              />
            ) : (
              <div className="aspect-[9/16] w-full rounded-lg bg-paper" />
            )}
            <div className="space-y-4">
              <div>
                <Label htmlFor="ig-caption">Caption</Label>
                <Textarea
                  id="ig-caption"
                  rows={5}
                  value={caption}
                  maxLength={CAPTION_MAX}
                  onChange={(e) => setCaption(e.target.value)}
                />
                <p className="mt-1 text-xs text-ink-soft">
                  {caption.length}/{CAPTION_MAX}. Licence credits for stock media are added at the end.
                </p>
              </div>
              <ErrorText>{error}</ErrorText>
              <Button onClick={post} loading={loading} data-testid="instagram-post">
                Post Reel
              </Button>
              <p className="text-xs text-ink-soft">
                The Reel also appears on your profile grid. Instagram allows a limited number of posts per 24
                hours; if you hit it, we post automatically when the limit resets.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
