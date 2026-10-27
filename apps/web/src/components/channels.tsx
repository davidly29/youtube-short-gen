"use client";
import { AlertTriangle, Link2Off, MonitorPlay, PauseCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { chooseActiveChannelsAction, disconnectAction } from "../../app/(app)/actions";
import { disconnectTikTokAction } from "../../app/(app)/publish/tiktok/actions";
import type { ChannelView } from "../server/channels";
import { Badge, Button, Card, ErrorText } from "./ui";

/** Over the plan's channel limit (after a downgrade): pick which channels keep publishing (E1-04). */
export function ChooseActiveChannels({
  channels,
  limit,
  planName,
}: {
  channels: ChannelView[];
  limit: number;
  planName: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(() =>
    channels.filter((c) => c.publishable).map((c) => c.id),
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <Card data-testid="choose-active">
      <h2 className="flex items-center gap-2 font-semibold">
        <PauseCircle className="size-5 text-warn" aria-hidden /> Choose which channels stay active
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Your {planName} plan includes {limit} channel{limit === 1 ? "" : "s"}. The others stay connected but
        paused (no publishing) until you upgrade or swap them here.{" "}
        <a href="/billing" className="font-semibold text-brand">
          Upgrade
        </a>
      </p>
      <ul className="mt-4 space-y-2">
        {channels.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`keep-${c.id}`}
                checked={picked.includes(c.id)}
                disabled={!picked.includes(c.id) && picked.length >= limit}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))
                }
              />
              {c.title}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <Button
          data-testid="save-active"
          loading={saving}
          disabled={picked.length === 0}
          onClick={async () => {
            setSaving(true);
            setError(undefined);
            const r = await chooseActiveChannelsAction(picked);
            setSaving(false);
            if (!r.ok) return setError(r.error);
            router.refresh();
          }}
        >
          Keep {picked.length} active
        </Button>
        <span className="text-xs text-ink-soft">
          {picked.length}/{limit} picked
        </span>
      </div>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function ChannelList({ initial }: { initial: ChannelView[] }) {
  const [channels, setChannels] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const router = useRouter();
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
                    href={
                      c.platform === "tiktok"
                        ? "/publish/tiktok/connect"
                        : c.platform === "instagram"
                          ? "/publish/instagram/connect"
                          : "/api/channels/youtube/start"
                    }
                  >
                    Reconnect
                  </a>
                </p>
              ) : c.publishable ? (
                <Badge tone="good">Connected</Badge>
              ) : (
                <span data-testid="channel-paused">
                  <Badge tone="warn">Paused: over your plan’s channel limit</Badge>
                </span>
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
                router.refresh(); // the plan limit may now fit, so paused channels can publish again
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
