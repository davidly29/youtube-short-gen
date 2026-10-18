# Infrastructure (Railway)

Project **shortloop** on Railway, environment `staging` (ADR 0003).

| Service             | Source                    | Notes                                                                                  |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `web`               | repo root, Railpack       | build `pnpm --filter @shortloop/web build`, start `pnpm --filter @shortloop/web start` |
| `worker`            | `infra/worker.Dockerfile` | Node 22 + FFmpeg; needs `DATABASE_URL`, `REDIS_URL`, storage env                       |
| `Postgres`, `Redis` | Railway templates         | referenced as `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`                     |

Storage env: `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Cloudflare R2). Without them the
worker writes to `STORAGE_DIR` (fine for a single-container smoke test, not for web + worker together).
