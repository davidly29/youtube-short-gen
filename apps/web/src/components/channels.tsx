"use client";
import { AlertTriangle, Link2Off, MonitorPlay } from "lucide-react";
import { useState } from "react";
import { disconnectAction } from "../../app/(app)/actions";
import { disconnectTikTokAction } from "../../app/(app)/publish/tiktok/actions";
import type { ChannelView } from "../server/channels";
import { Badge, Button, Card, ErrorText } from "./ui";

export function ChannelList({ initial }: { initial: ChannelView[] }) {
  const [channels, setChannels] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  if (channels.length === 0) {
    return (
      <p className="text-sm text-ink-soft" data-testid="no-channels">
        No channels yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3" data-testid="channel-list">
      {channels.map((c) => (
        <li key={c.id}>
          <Card className="flex flex-wrap items-center gap-4">
            {c.avatarUrl ? (
              // Channel avatars come from YouTube's CDN.
              <img src={c.avatarUrl} alt="" className="size-10 rounded-full" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-paper">
                <MonitorPlay className="size-5 text-bad" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {c.title}
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  {c.platform === "tiktok" ? "TikTok" : c.platform === "instagram" ? "Instagram" : "YouTube"}
                </span>
              </p>
              {c.status === "needs_reconnect" ? (
                <p className="mt-0.5 flex items-center gap-1 text-sm text-warn" data-testid="needs-reconnect">
                  <AlertTriangle className="size-4" aria-hidden /> Access expired.{" "}
                  <a
                    className="font-semibold underline"
                    href={c.platform === "tiktok" ? "/publish/tiktok/connect" : "/api/channels/youtube/start"}
                  >
                    Reconnect
                  </a>
                </p>
              ) : (
                <Badge tone="good">Connected</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              loading={busy === c.id}
              onClick={async () => {
                setBusy(c.id);
                const r = await (c.platform === "tiktok" ? disconnectTikTokAction : disconnectAction)(c.id);
                setBusy(undefined);
                if (!r.ok) return setError(r.error);
                setChannels(channels.filter((x) => x.id !== c.id));
              }}
            >
              <Link2Off className="size-4" aria-hidden /> Disconnect
            </Button>
          </Card>
        </li>
      ))}
      <ErrorText>{error}</ErrorText>
    </ul>
  );
}
