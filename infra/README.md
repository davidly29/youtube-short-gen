# Infrastructure (Railway)

Project **shortloop** on Railway, environment `staging` (ADR 0003).

| Service             | Source                    | Notes                                                                                  |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `web`               | repo root, Railpack       | build `pnpm --filter @shortloop/web build`, start `pnpm --filter @shortloop/web start` |
| `worker`            | `infra/worker.Dockerfile` | Node 22 + FFmpeg; needs `DATABASE_URL`, `REDIS_URL`, storage env                       |
| `Postgres`, `Redis` | Railway templates         | referenced as `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`                     |

Storage env: `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Cloudflare R2). Without them the
worker writes to `STORAGE_DIR` (fine for a single-container smoke test, not for web + worker together).

## Staging today (single web service, jobs in-process)

Until we need a separate worker, `web` runs every job itself (no `REDIS_URL` set). Staging has:

| Variable on `web`                             | Value                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                | `${{Postgres.DATABASE_URL}}`                                                                               |
| `S3_BUCKET` / `S3_ENDPOINT`                   | `${{media.BUCKET}}` / `${{media.ENDPOINT}}` (Railway bucket `media`)                                       |
| `S3_REGION`                                   | `${{media.REGION}}`                                                                                        |
| `S3_ACCESS_KEY_ID` / `..._KEY`                | `${{media.ACCESS_KEY_ID}}` / `${{media.SECRET_ACCESS_KEY}}`                                                |
| `BETTER_AUTH_URL`                             | `https://web-staging-0f0b5.up.railway.app`                                                                 |
| `BETTER_AUTH_SECRET`                          | random, set in Railway only                                                                                |
| `RAILPACK_DEPLOY_APT_PACKAGES`                | `ffmpeg fonts-dejavu-core` (rendering needs FFmpeg in the runtime image)                                   |
| `SHORTLOOP_SECRETS_KEY`                       | random, set in Railway only; encrypts users' own API keys (ADR 0006)                                       |
| `GOOGLE_CLIENT_ID` / `_SECRET`                | Google OAuth client for YouTube publishing + Google sign-in; see `docs/setup/google-oauth.md`              |
| `YOUTUBE_DAILY_UPLOAD_LIMIT`                  | uploads per Pacific day before holding posts (default 100, YouTube's default upload bucket)                |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | paid plans; see `docs/setup/stripe.md` (billing is off until set)                                          |
| `STRIPE_PRICE_CREATOR` / `STRIPE_PRICE_PRO`   | Stripe price ids for the two plans                                                                         |
| `ADMIN_EMAILS`                                | admin accounts (unlimited, Admin page); see `docs/setup/access.md`                                         |
| `SHORTLOOP_ACCESS_CODES`                      | beta codes `CODE:maxUses`; first N redeemers get unlimited Shorts                                          |
| `SHORTLOOP_SHARED_KEYS`                       | unset by default; `1` shares the operator's env AI keys with every user                                    |
| `YOUTUBE_API_KEY`                             | trend radar: YouTube most-popular metadata (worker); see `docs/setup/trends.md`                            |
| `TRENDS_REGIONS` / `TRENDS_CATEGORIES`        | trend radar regions (default `IE,GB,US`) and YouTube categories (default `27,28`)                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                 | optional, web + worker: OTLP/HTTP collector for traces; see `infra/otel/README.md`                         |
| `OTEL_EXPORTER_OTLP_HEADERS`                  | optional: collector auth headers, e.g. `x-api-key=...` (set in Railway only)                               |
| `SENTRY_DSN`                                  | optional, web + worker: error reporting to Sentry; off when unset                                          |
| `SHORTLOOP_ENV`                               | optional: environment name on traces and Sentry events (e.g. `staging`)                                    |
| `MANAGED_AI_ENABLED`                          | `1` turns on ShortLoop AI for paid plans and admins (kill switch); see `docs/setup/shortloop-ai.md`        |
| `MANAGED_GEMINI_API_KEY` / `MANAGED_FAL_KEY`  | ShortLoop AI keys: Gemini (scripts, premium images) and fal (images); set in Railway only                  |
| `MANAGED_ELEVENLABS_API_KEY`                  | ShortLoop AI voices (ElevenLabs Flash); set in Railway only                                                |
| `MANAGED_AI_DAILY_BUDGET_USD`                 | platform-wide ShortLoop AI ceiling per UTC day (default 25)                                                |
| `MANAGED_ADMIN_MONTHLY_USD`                   | ShortLoop AI ceiling per admin per month (default 50)                                                      |
| `ACRCLOUD_HOST` / `ACRCLOUD_ACCESS_KEY`       | music check on uploaded audio before publishing (web + worker); see `docs/setup/music-check.md`            |
| `ACRCLOUD_ACCESS_SECRET`                      | ACRCloud project secret; set in Railway only                                                               |
| `FINGERPRINT_REQUIRED`                        | `1` refuses to publish uploaded audio while the music check isn't configured (default: skip and record it) |
| Variable on `web`                             | Value                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------     |
| `DATABASE_URL`                                | `${{Postgres.DATABASE_URL}}`                                                                               |
| `S3_BUCKET` / `S3_ENDPOINT`                   | `${{media.BUCKET}}` / `${{media.ENDPOINT}}` (Railway bucket `media`)                                       |
| `S3_REGION`                                   | `${{media.REGION}}`                                                                                        |
| `S3_ACCESS_KEY_ID` / `..._KEY`                | `${{media.ACCESS_KEY_ID}}` / `${{media.SECRET_ACCESS_KEY}}`                                                |
| `BETTER_AUTH_URL`                             | `https://web-staging-0f0b5.up.railway.app`                                                                 |
| `BETTER_AUTH_SECRET`                          | random, set in Railway only                                                                                |
| `RAILPACK_DEPLOY_APT_PACKAGES`                | `ffmpeg fonts-dejavu-core` (rendering needs FFmpeg in the runtime image)                                   |
| `SHORTLOOP_SECRETS_KEY`                       | random, set in Railway only; encrypts users' own API keys (ADR 0006)                                       |
| `GOOGLE_CLIENT_ID` / `_SECRET`                | Google OAuth client for YouTube publishing + Google sign-in; see `docs/setup/google-oauth.md`              |
| `YOUTUBE_DAILY_UPLOAD_LIMIT`                  | uploads per Pacific day before holding posts (default 100, YouTube's default upload bucket)                |
| `TIKTOK_CLIENT_KEY` / `_SECRET`               | TikTok Login Kit + Content Posting app; see `docs/setup/tiktok.md` (TikTok posting is off until set)       |
| `TIKTOK_AUDITED`                              | unset until TikTok approves the Direct Post audit (H-01); until then every post is private ("Only me")     |
| `INSTAGRAM_APP_ID` / `_SECRET`                | Meta app with Instagram Login for Reels (E8-04); see `docs/setup/instagram.md`                             |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | paid plans; see `docs/setup/stripe.md` (billing is off until set)                                          |
| `STRIPE_PRICE_CREATOR` / `STRIPE_PRICE_PRO`   | Stripe price ids for the two plans                                                                         |
| `ADMIN_EMAILS`                                | admin accounts (unlimited, Admin page); see `docs/setup/access.md`                                         |
| `SHORTLOOP_ACCESS_CODES`                      | beta codes `CODE:maxUses`; first N redeemers get unlimited Shorts                                          |
| `SHORTLOOP_SHARED_KEYS`                       | unset by default; `1` shares the operator's env AI keys with every user                                    |
| `YOUTUBE_API_KEY`                             | trend radar: YouTube most-popular metadata (worker); see `docs/setup/trends.md`                            |
| `TRENDS_REGIONS` / `TRENDS_CATEGORIES`        | trend radar regions (default `IE,GB,US`) and YouTube categories (default `27,28`)                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                 | optional, web + worker: OTLP/HTTP collector for traces; see `infra/otel/README.md`                         |
| `OTEL_EXPORTER_OTLP_HEADERS`                  | optional: collector auth headers, e.g. `x-api-key=...` (set in Railway only)                               |
| `SENTRY_DSN`                                  | optional, web + worker: error reporting to Sentry; off when unset                                          |
| `SHORTLOOP_ENV`                               | optional: environment name on traces and Sentry events (e.g. `staging`)                                    |
| `MANAGED_AI_ENABLED`                          | `1` turns on ShortLoop AI for paid plans and admins (kill switch); see `docs/setup/shortloop-ai.md`        |
| `MANAGED_GEMINI_API_KEY` / `MANAGED_FAL_KEY`  | ShortLoop AI keys: Gemini (scripts, premium images) and fal (images); set in Railway only                  |
| `MANAGED_ELEVENLABS_API_KEY`                  | ShortLoop AI voices (ElevenLabs Flash); set in Railway only                                                |
| `MANAGED_AI_DAILY_BUDGET_USD`                 | platform-wide ShortLoop AI ceiling per UTC day (default 25)                                                |
| `MANAGED_ADMIN_MONTHLY_USD`                   | ShortLoop AI ceiling per admin per month (default 50)                                                      |

Users add their own AI keys in Settings → API keys (ADR 0006) and choose a provider per job (ADR 0007). The operator
pays for free defaults and, when `MANAGED_AI_ENABLED=1`, for ShortLoop AI on paid plans, within the caps in ADR 0007.

Browser uploads go to the app's signed `/api/uploads/put/...` route, which streams to the bucket, so the bucket
needs no CORS rule. Media is served to the browser with short-lived presigned GET URLs.

To split out the worker later: add Redis, set `REDIS_URL` on both `web` and `worker`, deploy `infra/worker.Dockerfile`.
