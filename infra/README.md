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

| Variable on `web`                             | Value                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                | `${{Postgres.DATABASE_URL}}`                                                                  |
| `S3_BUCKET` / `S3_ENDPOINT`                   | `${{media.BUCKET}}` / `${{media.ENDPOINT}}` (Railway bucket `media`)                          |
| `S3_REGION`                                   | `${{media.REGION}}`                                                                           |
| `S3_ACCESS_KEY_ID` / `..._KEY`                | `${{media.ACCESS_KEY_ID}}` / `${{media.SECRET_ACCESS_KEY}}`                                   |
| `BETTER_AUTH_URL`                             | `https://web-staging-0f0b5.up.railway.app`                                                    |
| `BETTER_AUTH_SECRET`                          | random, set in Railway only                                                                   |
| `RAILPACK_DEPLOY_APT_PACKAGES`                | `ffmpeg fonts-dejavu-core` (rendering needs FFmpeg in the runtime image)                      |
| `SHORTLOOP_SECRETS_KEY`                       | random, set in Railway only; encrypts users' own API keys (ADR 0006)                          |
| `GOOGLE_CLIENT_ID` / `_SECRET`                | Google OAuth client for YouTube publishing + Google sign-in; see `docs/setup/google-oauth.md` |
| `YOUTUBE_DAILY_UPLOAD_LIMIT`                  | uploads per Pacific day before holding posts (default 100, YouTube's default upload bucket)   |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | paid plans; see `docs/setup/stripe.md` (billing is off until set)                             |
| `STRIPE_PRICE_CREATOR` / `STRIPE_PRICE_PRO`   | Stripe price ids for the two plans                                                            |
| `ADMIN_EMAILS`                                | admin accounts (unlimited, Admin page); see `docs/setup/access.md`                            |
| `SHORTLOOP_ACCESS_CODES`                      | beta codes `CODE:maxUses`; first N redeemers get unlimited Shorts                             |
| `SHORTLOOP_SHARED_KEYS`                       | unset by default; `1` shares the operator's env AI keys with every user                       |

Users add their own AI keys in Settings → API keys (ADR 0006); the operator pays only for free defaults.

Browser uploads go to the app's signed `/api/uploads/put/...` route, which streams to the bucket, so the bucket
needs no CORS rule. Media is served to the browser with short-lived presigned GET URLs.

To split out the worker later: add Redis, set `REDIS_URL` on both `web` and `worker`, deploy `infra/worker.Dockerfile`.
