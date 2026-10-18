# ADR 0002: PGlite for tests and local development

- Status: accepted (owner decision on #3, 2026-10-18)

## Decision

Tests and local development use [PGlite](https://pglite.dev) (Postgres compiled to WASM, in-process).
Staging and production use real Postgres on Railway (#54). `openDb(url)` picks the driver:
`postgres://…` uses node-postgres, `memory://` gives an in-memory PGlite, and any other value is a PGlite data directory.

## Why

Scheduled agent runs and CI should not need Docker. PGlite runs the same SQL, including enums, jsonb, partial
unique indexes and plpgsql triggers, so migrations are exercised for real.

## Consequences

- Keep the schema to standard Postgres features; no PGlite-only extensions.
- Testcontainers can be added later for a nightly "real Postgres" check if drift is ever suspected.
