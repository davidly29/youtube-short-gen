import { CheckCircle2, ShieldCheck, MonitorPlay } from "lucide-react";
import { ChannelList } from "../../../src/components/channels";
import { Card, ErrorText } from "../../../src/components/ui";
import { requireUser } from "../../../src/server/auth";
import { getTodayBrief, NICHE_OPTIONS } from "../../../src/server/brief";
import { listChannels, youtubeConfigured } from "../../../src/server/channels";
import { NicheSelect } from "../today/niche-select";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const user = await requireUser();
  const [channels, configured, q, niches] = await Promise.all([
    listChannels(user.id),
    youtubeConfigured(),
    searchParams,
    getTodayBrief(user.id),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="mt-1 text-sm text-ink-soft">Where your approved Shorts get published.</p>
      </div>
      {q.connected && (
        <p
          className="flex items-center gap-2 rounded-lg bg-good/10 px-4 py-3 text-sm font-medium text-good"
          data-testid="connected-banner"
        >
          <CheckCircle2 className="size-4" aria-hidden /> Channel connected.
        </p>
      )}
      <ErrorText>{q.error}</ErrorText>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <MonitorPlay className="size-5 text-bad" aria-hidden /> YouTube
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-soft">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              We ask only to upload videos and read your channel name. We can’t delete or edit your existing
              videos.
            </p>
          </div>
          {configured ? (
            <a
              href="/api/channels/youtube/start"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
              data-testid="connect-youtube"
            >
              Connect YouTube channel
            </a>
          ) : (
            <p className="max-w-xs text-sm text-ink-soft" data-testid="youtube-not-configured">
              YouTube publishing isn’t switched on for this server yet (it needs a Google OAuth client).
            </p>
          )}
        </div>
      </Card>
      <ChannelList initial={channels} />
      {niches.length > 0 && (
        <Card data-testid="channel-niches">
          <h2 className="font-semibold">Daily brief niche</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Each channel gets fresh angles every morning on Today, from what’s trending in its niche.
          </p>
          <div className="mt-4 space-y-4">
            {niches.map(({ channel, niche }) => (
              <div key={channel.id}>
                <p className="mb-1 text-sm font-medium">{channel.title}</p>
                <NicheSelect channelId={channel.id} current={niche?.id} options={NICHE_OPTIONS} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
