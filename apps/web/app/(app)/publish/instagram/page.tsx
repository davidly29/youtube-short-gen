import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ErrorText } from "../../../../src/components/ui";
import { requireUser } from "../../../../src/server/auth";
import { UserError } from "../../../../src/server/errors";
import { InstagramPostForm } from "./form";
import { instagramPostPage } from "./service";

export const dynamic = "force-dynamic";

/** E8-04b: post an approved Short to an Instagram Professional account as a Reel. */
export default async function InstagramPublishPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; connected?: string; error?: string }>;
}) {
  const user = await requireUser();
  const q = await searchParams;
  if (!q.project) notFound();
  let page;
  try {
    page = await instagramPostPage(user.id, q.project);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const connectHref = `/publish/instagram/connect?project=${encodeURIComponent(page.project.id)}`;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/projects/${page.project.id}`} className="text-sm font-semibold text-brand">
          ← Back to {page.project.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Post to Instagram</h1>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-soft">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your Short goes up as a Reel, exactly as rendered, with the licence credits added to the caption.
        </p>
      </div>
      {q.connected && (
        <p
          className="flex items-center gap-2 rounded-lg bg-good/10 px-4 py-3 text-sm font-medium text-good"
          data-testid="instagram-connected-banner"
        >
          <CheckCircle2 className="size-4" aria-hidden /> Instagram account connected.
        </p>
      )}
      <div data-testid="instagram-error">
        <ErrorText>{q.error}</ErrorText>
      </div>

      {!page.configured ? (
        <Card data-testid="instagram-not-configured">
          <p className="text-sm text-ink-soft">
            Instagram posting isn’t switched on for this server yet (it needs a Meta app with Instagram
            Login).
          </p>
        </Card>
      ) : !page.approved ? (
        <Card data-testid="instagram-not-approved">
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
            Connect an Instagram Professional (Creator or Business) account. We ask only to read your basic
            profile and to post Reels you choose to publish.
          </p>
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
            data-testid="connect-instagram"
          >
            Connect Instagram
          </a>
        </Card>
      ) : page.channel.status === "needs_reconnect" ? (
        <Card data-testid="instagram-needs-reconnect">
          <p className="flex items-center gap-2 text-sm text-warn">
            <AlertTriangle className="size-4" aria-hidden /> Instagram access for {page.channel.title}{" "}
            expired.{" "}
            <a className="font-semibold underline" href={connectHref}>
              Reconnect
            </a>
          </p>
        </Card>
      ) : !page.publishable.ok ? (
        <Card>
          <ErrorText>{page.publishable.problems.join(" ")}</ErrorText>
        </Card>
      ) : (
        <InstagramPostForm
          projectId={page.project.id}
          channel={page.channel}
          defaultCaption={page.defaultCaption}
          videoUrl={page.videoUrl}
          thumbUrl={page.thumbUrl}
          publishes={page.publishes}
        />
      )}
    </div>
  );
}
