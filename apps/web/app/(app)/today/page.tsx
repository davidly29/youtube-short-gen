import { ArrowRight, ExternalLink, MonitorPlay, Sunrise } from "lucide-react";
import Link from "next/link";
import { Badge, Card } from "../../../src/components/ui";
import { requireUser } from "../../../src/server/auth";
import { getTodayBrief, NICHE_OPTIONS } from "../../../src/server/brief";
import { NicheSelect } from "./niche-select";

const FORMAT_LABEL: Record<string, string> = {
  "trend-explainer": "Trend explainer",
  "myth-vs-fact": "Myth vs fact",
  "top-3-list": "Top 3 list",
  "news-in-60s": "News in 60s",
};

/** Today's angles for each channel (E3-03b): built every morning from the channel's niche. */
export default async function TodayPage() {
  const user = await requireUser();
  const channels = await getTodayBrief(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sunrise className="size-6 text-brand" aria-hidden /> Today
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Fresh angles on what’s trending in your niche, ready to turn into a Short.
        </p>
      </div>

      {channels.length === 0 && (
        <Card data-testid="today-no-channels">
          <p className="text-sm text-ink-soft">
            Connect a channel and pick its niche to get a daily brief.{" "}
            <Link href="/channels" className="font-semibold text-brand hover:underline">
              Connect a channel
            </Link>
          </p>
        </Card>
      )}

      {channels.map(({ channel, niche, brief, started }) => (
        <section key={channel.id} className="space-y-3" data-testid={`today-channel-${channel.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <MonitorPlay className="size-5 text-bad" aria-hidden />
            <h2 className="font-semibold">{channel.title}</h2>
            {niche && <Badge tone="brand">{niche.name}</Badge>}
            {brief && (
              <span className="text-xs text-ink-soft" data-testid="brief-date">
                Brief for {brief.date}
              </span>
            )}
          </div>

          {!niche && (
            <Card>
              <p className="mb-3 text-sm text-ink-soft">
                Pick this channel’s niche and we’ll send fresh angles every morning.
              </p>
              <NicheSelect channelId={channel.id} options={NICHE_OPTIONS} />
            </Card>
          )}

          {niche && !brief && (
            <Card data-testid="brief-pending">
              <p className="text-sm text-ink-soft">Your first brief arrives tomorrow morning.</p>
            </Card>
          )}

          {brief && brief.items.length === 0 && (
            <Card data-testid="brief-empty">
              <p className="text-sm text-ink-soft">
                Nothing new is trending in {niche?.name ?? "your niche"} today. Check back tomorrow.
              </p>
            </Card>
          )}

          {brief?.items.map((item) => {
            const projectId = started[item.topicId];
            const topic = item.sources[0]?.title ?? item.hook;
            const href = `/new?${new URLSearchParams({ topic, angle: item.angle, topicId: item.topicId })}`;
            return (
              <Card key={item.topicId} data-testid="brief-item">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold leading-snug">{item.hook}</p>
                    <p className="mt-1 text-sm text-ink">{item.angle}</p>
                  </div>
                  <Badge>{FORMAT_LABEL[item.format] ?? item.format}</Badge>
                </div>
                <p className="mt-3 text-xs text-ink-soft">Why now: {item.whyNow}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {item.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        {s.title} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {projectId ? (
                    <Link
                      href={`/projects/${projectId}`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-good hover:underline"
                      data-testid="brief-item-started"
                    >
                      Short in progress: open project <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  ) : (
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep"
                      data-testid="make-this-short"
                    >
                      Make this Short <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}

          {niche && (
            <details className="text-sm text-ink-soft">
              <summary className="cursor-pointer">Change niche</summary>
              <div className="mt-3">
                <NicheSelect channelId={channel.id} current={niche.id} options={NICHE_OPTIONS} />
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
