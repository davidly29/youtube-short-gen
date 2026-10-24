"use client";
import type { ShortPerformance } from "@shortloop/contracts";
import { BarChart3, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshStatsAction } from "../../app/(app)/actions";
import { Button, Card, ErrorText } from "./ui";

const n = (v: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v);

/** Views and retention per published Short (E10-01), from each channel's own YouTube Analytics. */
export function PerformanceCard({
  shorts,
  reconnect,
}: {
  shorts: ShortPerformance[];
  reconnect: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  async function refresh() {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    const r = await refreshStatsAction();
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      if (!r.data.done) setNote("Fetching the latest numbers. Check back in a minute.");
      router.refresh();
    }
  }

  return (
    <Card className="mb-6" data-testid="performance-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <BarChart3 className="size-4 text-brand" aria-hidden /> Performance
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Views and average % viewed per Short, from your channel&rsquo;s YouTube stats (last 28 days on
            first connect, then daily). Numbers lag YouTube by a day or two.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} loading={busy} data-testid="refresh-stats">
          {!busy && <RefreshCw className="size-4" aria-hidden />} Refresh stats
        </Button>
      </div>
      {reconnect.length > 0 && (
        <p className="mb-3 rounded-lg bg-paper px-3 py-2 text-sm" data-testid="stats-reconnect">
          {reconnect.map((c) => c.title).join(", ")} was connected before ShortLoop could read stats.{" "}
          <a
            href="/api/channels/youtube/start"
            className="font-semibold text-brand underline"
            data-testid="stats-reconnect-link"
          >
            Reconnect
          </a>{" "}
          to share its YouTube stats (read-only). Publishing keeps working either way.
        </p>
      )}
      {note && <p className="mb-3 text-sm text-ink-soft">{note}</p>}
      <ErrorText>{error}</ErrorText>
      {shorts.length === 0 ? (
        <p className="text-sm text-ink-soft" data-testid="no-stats">
          Publish a Short and its numbers show up here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="stats-table">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-2 pr-3 font-medium">Short</th>
                <th className="py-2 pr-3 text-right font-medium">Views</th>
                <th className="py-2 pr-3 text-right font-medium">Avg % viewed</th>
                <th className="py-2 pr-3 text-right font-medium">Likes</th>
                <th className="py-2 text-right font-medium">Subs</th>
              </tr>
            </thead>
            <tbody>
              {shorts.map((s) => (
                <tr key={s.publishId} className="border-t border-line" data-testid="stats-row">
                  <td className="py-2 pr-3">
                    {s.projectId ? (
                      <Link href={`/projects/${s.projectId}`} className="font-medium hover:text-brand">
                        {s.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{s.title}</span>
                    )}
                    <span className="block text-xs text-ink-soft">{s.channelTitle}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" data-testid="stats-views">
                    {s.days ? n(s.views) : "–"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" data-testid="stats-retention">
                    {s.avgViewPct !== undefined ? `${s.avgViewPct.toFixed(1)}%` : "–"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.days ? n(s.likes) : "–"}</td>
                  <td className="py-2 text-right tabular-nums">{s.days ? n(s.subsGained) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
