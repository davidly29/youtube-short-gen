"use client";
import { Info, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  allowedPrivacy,
  BRANDED_CONTENT_URL,
  commercialLabel,
  declarationParts,
  MUSIC_USAGE_URL,
  PRIVACY_LABELS,
  TIKTOK_TITLE_MAX,
  tiktokPostProblems,
  type CreatorInfo,
  type TikTokPostForm as Form,
  type TikTokPrivacy,
} from "@shortloop/providers/tiktok-rules";
import { Badge, Button, Card, ErrorText, Label, Select, Textarea } from "../../../../src/components/ui";
import { disconnectTikTokAction, postToTikTokAction } from "./actions";
import type { TikTokPublishView } from "./service";

const STATUS: Record<string, { label: string; tone: "neutral" | "brand" | "good" | "bad" }> = {
  uploading: { label: "Processing on TikTok…", tone: "brand" },
  published: { label: "Posted", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

export function TikTokPostForm(props: {
  projectId: string;
  channel: { id: string; title: string };
  creator: CreatorInfo;
  audited: boolean;
  aiRequired: boolean;
  videoDurationSec: number;
  videoUrl?: string;
  thumbUrl?: string;
  publishes: TikTokPublishView[];
}) {
  const { creator, audited, aiRequired } = props;
  const router = useRouter();
  // TikTok's guidelines: no default visibility, interactions off until the user turns them on,
  // commercial disclosure off by default.
  const [form, setForm] = useState<Form>({
    title: "",
    privacyLevel: undefined,
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    commercial: false,
    yourBrand: false,
    brandedContent: false,
    aiGenerated: aiRequired,
    consent: false,
  });
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const ctx = { creator, audited, videoDurationSec: props.videoDurationSec, aiRequired };
  const options = allowedPrivacy(ctx);
  const problems = tiktokPostProblems(form, ctx);
  const label = commercialLabel(form);
  const declaration = declarationParts(form);
  const live = props.publishes.find((p) => p.status !== "failed");

  async function post() {
    setLoading(true);
    setError(undefined);
    const r = await postToTikTokAction(props.projectId, form);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4" data-testid="tiktok-account">
        {creator.avatarUrl ? (
          // Creator avatars come from TikTok's CDN.
          <img src={creator.avatarUrl} alt="" className="size-10 rounded-full" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-paper text-sm font-bold">
            {creator.nickname.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-soft">Posting to</p>
          <p className="truncate font-semibold" data-testid="tiktok-creator">
            {creator.nickname}
            {creator.username && <span className="font-normal text-ink-soft"> @{creator.username}</span>}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            const r = await disconnectTikTokAction(props.channel.id);
            if (!r.ok) return setError(r.error);
            router.refresh();
          }}
        >
          <Link2Off className="size-4" aria-hidden /> Disconnect
        </Button>
      </Card>

      {props.publishes.length > 0 && (
        <Card data-testid="tiktok-publishes">
          <h2 className="font-semibold">Posts</h2>
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
                    <p className="mt-1 text-xs text-ink-soft" data-testid="tiktok-processing">
                      TikTok is processing your video. It can take a few minutes to appear on your profile.
                    </p>
                  )}
                  {p.status === "published" &&
                    (p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs font-semibold text-brand"
                        data-testid="tiktok-link"
                      >
                        View on TikTok
                      </a>
                    ) : (
                      <p className="mt-1 text-xs text-ink-soft" data-testid="tiktok-private-done">
                        Posted privately. Find it on your TikTok profile.
                      </p>
                    ))}
                  {p.error && <p className="mt-1 text-xs text-bad">{p.error}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!live && (
        <Card data-testid="tiktok-form">
          <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
            <div>
              <p className="mb-1.5 text-sm font-medium">Preview</p>
              {props.videoUrl ? (
                <video
                  src={props.videoUrl}
                  poster={props.thumbUrl}
                  controls
                  playsInline
                  className="aspect-[9/16] w-full rounded-lg bg-ink"
                  data-testid="tiktok-preview"
                />
              ) : null}
              <p className="mt-1 text-xs text-ink-soft">{Math.round(props.videoDurationSec)}s</p>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="tt-title">Caption</Label>
                <Textarea
                  id="tt-title"
                  value={form.title}
                  maxLength={TIKTOK_TITLE_MAX}
                  placeholder="Write a caption and #hashtags"
                  onChange={(e) => set({ title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="tt-privacy">Who can view this video</Label>
                <Select
                  id="tt-privacy"
                  value={form.privacyLevel ?? ""}
                  onChange={(e) =>
                    set({ privacyLevel: (e.target.value || undefined) as TikTokPrivacy | undefined })
                  }
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {creator.privacyLevelOptions.map((p) => {
                    const blocked =
                      !options.includes(p) || (form.commercial && form.brandedContent && p === "SELF_ONLY");
                    return (
                      <option key={p} value={p} disabled={blocked}>
                        {PRIVACY_LABELS[p]}
                        {!options.includes(p) ? " (after TikTok approves ShortLoop)" : ""}
                        {form.commercial && form.brandedContent && p === "SELF_ONLY"
                          ? " (not for branded content)"
                          : ""}
                      </option>
                    );
                  })}
                </Select>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Allow users to</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(
                    [
                      ["allowComment", "Comment", creator.commentDisabled],
                      ["allowDuet", "Duet", creator.duetDisabled],
                      ["allowStitch", "Stitch", creator.stitchDisabled],
                    ] as const
                  ).map(([k, name, off]) => (
                    <label
                      key={k}
                      className={off ? "flex items-center gap-2 opacity-50" : "flex items-center gap-2"}
                    >
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={form[k]}
                        disabled={off}
                        onChange={(e) => set({ [k]: e.target.checked } as Partial<Form>)}
                      />
                      {name}
                      {off && <span className="text-xs text-ink-soft">(off in your TikTok settings)</span>}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="rounded-lg border border-line p-3 text-sm">
                <label className="flex items-center justify-between gap-2 font-medium">
                  Disclose video content
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Disclose video content"
                    className="accent-brand"
                    checked={form.commercial}
                    onChange={(e) =>
                      set({ commercial: e.target.checked, yourBrand: false, brandedContent: false })
                    }
                  />
                </label>
                <p className="mt-1 text-xs text-ink-soft">
                  Turn on to disclose that this video promotes goods or services in exchange for something of
                  value. Your video could promote yourself, a third party, or both.
                </p>
                {form.commercial && (
                  <div className="mt-3 space-y-2" data-testid="commercial-options">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-brand"
                        checked={form.yourBrand}
                        onChange={(e) => set({ yourBrand: e.target.checked })}
                      />
                      <span>
                        <span className="font-medium">Your brand</span>
                        <span className="block text-xs text-ink-soft">
                          You are promoting yourself or your own business.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-brand"
                        checked={form.brandedContent}
                        onChange={(e) =>
                          set({
                            brandedContent: e.target.checked,
                            privacyLevel:
                              e.target.checked && form.privacyLevel === "SELF_ONLY"
                                ? undefined
                                : form.privacyLevel,
                          })
                        }
                      />
                      <span>
                        <span className="font-medium">Branded content</span>
                        <span className="block text-xs text-ink-soft">
                          You are promoting another brand or a third party.
                        </span>
                      </span>
                    </label>
                    {label && (
                      <p
                        className="flex items-center gap-1.5 text-xs text-ink-soft"
                        data-testid="commercial-label"
                      >
                        <Info className="size-3.5" aria-hidden /> Your video will be labeled as “{label}”.
                      </p>
                    )}
                    {form.brandedContent && (
                      <p className="text-xs text-ink-soft">
                        Branded content visibility can’t be set to private.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-brand"
                  checked={form.aiGenerated || aiRequired}
                  disabled={aiRequired}
                  onChange={(e) => set({ aiGenerated: e.target.checked })}
                />
                <span>
                  <span className="font-medium">AI-generated content</span>
                  <span className="block text-xs text-ink-soft">
                    {aiRequired
                      ? "Required: this Short uses realistic AI visuals or an AI voice, so TikTok's AI-generated label is on."
                      : "Adds TikTok's AI-generated label to the post."}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm" data-testid="tiktok-declaration">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-brand"
                  checked={form.consent}
                  onChange={(e) => set({ consent: e.target.checked })}
                />
                <span>
                  By posting, you agree to TikTok’s{" "}
                  {declaration.includes("branded_content_policy") && (
                    <>
                      <a
                        href={BRANDED_CONTENT_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand"
                      >
                        Branded Content Policy
                      </a>{" "}
                      and{" "}
                    </>
                  )}
                  <a
                    href={MUSIC_USAGE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-brand"
                  >
                    Music Usage Confirmation
                  </a>
                  .
                </span>
              </label>

              {problems.length > 0 && (
                <ul
                  className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft"
                  data-testid="tiktok-problems"
                >
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <ErrorText>{error}</ErrorText>
              <Button
                onClick={post}
                loading={loading}
                disabled={problems.length > 0}
                data-testid="tiktok-post"
              >
                Post to TikTok
              </Button>
              <p className="text-xs text-ink-soft">
                After you post, TikTok can take a few minutes to process the video before it appears on your
                profile.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
