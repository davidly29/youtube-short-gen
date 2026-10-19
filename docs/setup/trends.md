# Trend radar collectors (E3-01, E3-01c)

The worker collects trend signals every hour from free, official sources. It reads **metadata only** (titles, tags,
view counts, feed XML): no video, audio, thumbnail, enclosure or article is ever downloaded. Collection is
platform-level: it runs on the operator's keys, costs users no credits, and its jobs are owned by a `system` user.

| Source                        | Needs                       | What it reads                                                                 |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| YouTube most-popular          | `YOUTUBE_API_KEY`           | `videos.list?chart=mostPopular` per region × category (1 quota unit per call) |
| Wikipedia pageviews           | nothing                     | Wikimedia `top-per-country` pageviews for the latest published day            |
| Niche RSS/Atom feeds (global) | nothing                     | the publisher feeds in `packages/providers/src/trends/feeds.json` (reviewed)  |
| Google Trends                 | owner decision pending, #76 | not collected                                                                 |

Signals land in the `trend_signals` table (one row per source, region, category, title and hour) and are pruned after
30 days.

## Environment (worker service)

| Variable            | Default    | Notes                                                                                           |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `YOUTUBE_API_KEY`   | unset      | A Google Cloud **API key** restricted to the YouTube Data API v3. Without it YouTube is skipped |
| `TRENDS_REGIONS`    | `IE,GB,US` | Comma-separated ISO 3166-1 alpha-2 codes                                                        |
| `TRENDS_CATEGORIES` | `27,28`    | YouTube category ids (27 Education, 28 Science & Technology)                                    |

**Quota.** Each region uses `categories × 24` units/day (48 with the defaults). The worker refuses a category list
above 500 units/day per region and logs `trend collection disabled`.

## Getting a YouTube API key

1. In the Google Cloud project from [google-oauth.md](google-oauth.md) (#46), enable **YouTube Data API v3**.
2. **APIs & Services → Credentials → Create credentials → API key**.
3. Restrict it: _API restrictions_ → YouTube Data API v3 only.
4. Set it as `YOUTUBE_API_KEY` on the worker service in Railway (never in the repo).

## Where it runs

The hourly schedule starts in the standalone worker (`apps/worker/src/main.ts`). Staging currently runs jobs inside
the `web` service (no `REDIS_URL`), which does not start the trend schedule yet; wiring it there is a follow-up.

## Changing the feed list

Edit `feeds.json` (`niche`, `name`, `feedUrl`, `homepageUrl`; publisher feeds only, 2–3 per niche) in a PR. The
`pnpm -F providers test trends-rss` test checks every entry.
