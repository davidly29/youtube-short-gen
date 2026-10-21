import { AlertTriangle, CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ErrorText } from "../../../../src/components/ui";
import { requireUser } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import { TikTokPostForm } from "./form";
import { tiktokPostPage } from "./service";

export const dynamic = "force-dynamic";

/** E8-03: post an approved Short to TikTok with Direct Post, following TikTok's content-sharing guidelines. */
export default async function TikTokPublishPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; connected?: string; error?: string }>;
}) {
  const user = await requireUser();
  const q = await searchParams;
  if (!q.project) notFound();
  let page;
  try {
    page = await tiktokPostPage(user.id, q.project);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const connectHref = `/publish/tiktok/connect?project=${encodeURIComponent(page.project.id)}`;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/projects/${page.project.id}`} className="text-sm font-semibold text-brand">
          ← Back to {page.project.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Post to TikTok</h1>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-soft">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          We send your Short to TikTok exactly as rendered. No ShortLoop watermark or branding is added.
        </p>
      </div>
      {!page.audited && (
        <p
          className="flex items-start gap-2 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn"
          data-testid="unaudited-notice"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Posts will be private.</strong> TikTok hasn’t finished reviewing ShortLoop yet, so every
            post goes up as “Only me” and your TikTok account must be set to private. You can change who sees
            it in the TikTok app afterwards.
          </span>
        </p>
      )}
      {q.connected && (
        <p
          className="flex items-center gap-2 rounded-lg bg-good/10 px-4 py-3 text-sm font-medium text-good"
          data-testid="tiktok-connected-banner"
        >
          <CheckCircle2 className="size-4" aria-hidden /> TikTok account connected.
        </p>
      )}
      <ErrorText>{q.error}</ErrorText>

      {!page.configured ? (
        <Card data-testid="tiktok-not-configured">
          <p className="text-sm text-ink-soft">
            TikTok posting isn’t switched on for this server yet (it needs a TikTok developer app).
          </p>
        </Card>
      ) : !page.approved ? (
        <Card data-testid="tiktok-not-approved">
          <p className="text-sm text-ink-soft">
            Approve this Short on its{" "}
            <Link href={`/projects/${page.project.id}`} className="font-semibold text-brand">
              review screen
            </Link>{" "}
            before posting it.
          </p>
        </Card>
      ) : !page.channel ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-ink-soft">
            Connect your TikTok account. We ask only to read your basic profile and to post videos you choose
            to publish; we can’t see or change anything else.
          </p>
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
            data-testid="connect-tiktok"
          >
            Connect TikTok
          </a>
        </Card>
      ) : page.channel.status === "needs_reconnect" ? (
        <Card data-testid="tiktok-needs-reconnect">
          <p className="flex items-center gap-2 text-sm text-warn">
            <AlertTriangle className="size-4" aria-hidden /> TikTok access for {page.channel.title} expired.{" "}
            <a className="font-semibold underline" href={connectHref}>
              Reconnect
            </a>
          </p>
        </Card>
      ) : page.creatorError || !page.creator ? (
        <Card data-testid="tiktok-cannot-post">
          <p className="flex items-start gap-2 text-sm text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {page.creatorError ?? "TikTok isn't letting this account post right now. Try again later."}
          </p>
        </Card>
      ) : !page.publishable.ok ? (
        <Card>
          <ErrorText>{page.publishable.problems.join(" ")}</ErrorText>
        </Card>
      ) : (
        <TikTokPostForm
          projectId={page.project.id}
          channel={page.channel}
          creator={page.creator}
          audited={page.audited}
          aiRequired={page.aiRequired}
          videoDurationSec={page.videoDurationSec}
          videoUrl={page.videoUrl}
          thumbUrl={page.thumbUrl}
          publishes={page.publishes}
        />
      )}
    </div>
  );
}
