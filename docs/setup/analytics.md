# Short performance stats and the feature store (E10-01, E10-02)

ShortLoop reads each published Short's daily numbers from the **YouTube Analytics API** with the channel's own
OAuth grant (read-only scope `yt-analytics.readonly`), and keeps a feature row describing how each Short was made.
No new environment variables: it uses the same Google OAuth client as publishing (`docs/setup/google-oauth.md`).

## What the owner needs to do once

1. Cloud Console → **APIs & Services → Library** → enable **YouTube Analytics API** for the ShortLoop project.
2. **OAuth consent screen → Scopes**: add `https://www.googleapis.com/auth/yt-analytics.readonly`.
3. Channels connected before this change keep publishing; **Your Shorts** shows a "Reconnect" link for them so the
   creator can grant the new read-only permission (allowed even when they're at their plan's channel limit).

## How it runs

- **Daily**: the worker (or the web process in all-in-one mode) enqueues one `analytics` job per connected channel
  per UTC day (`analytics:<channelId>:<date>`). It costs no credits and uses no AI keys.
- **On connect / reconnect**: one job right away, so a channel's existing ShortLoop Shorts get their last 28 days.
- **Refresh stats** on **Your Shorts**: one job per channel, at most once an hour.
- Each job first gives every live Short on the channel a feature row (`short_features`), then, for YouTube channels
  with the analytics grant, reads per-Short daily metrics and upserts them into `short_metrics` by (publish, day):
  28 days back on a Short's first read, afterwards the last 3 days (YouTube revises recent days) plus any gap.
  Shorts older than 90 days stop being refreshed. Days are YouTube's reporting days.
- TikTok and Instagram insights aren't read yet (those channels still get feature rows).

## Exporting the feature store to Parquet

```bash
DATABASE_URL=postgres://... pnpm -F @shortloop/worker export:features shorts.parquet [--owner <userId>]
```

Use a `DATABASE_URL` that reaches the database (for staging, Railway's public Postgres URL).

One row per live Short: ids, platform, `published_at`, the features (`hook_type`, `hook_words`, `duration_s`,
`beats`, `caption_style`, `voice_id`, `visual_own/stock/ai`, `format`, `topic_velocity`, `post_hour`) and metric
totals (`metric_days`, `views`, `avg_view_pct` weighted by views, `likes`, `comments`, `subs_gained`). Open it with
DuckDB (`select * from 'shorts.parquet'`) or pandas (`pd.read_parquet`).
