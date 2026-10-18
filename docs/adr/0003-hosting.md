# ADR 0003: Railway hosting

- Status: accepted (owner decision on #54, 2026-10-18)

Staging and production run on Railway: `web` (Next.js via Railpack), `worker` (Docker image with FFmpeg), managed
Postgres and Redis. Media lives in Cloudflare R2 behind signed URLs. See `infra/README.md`.
