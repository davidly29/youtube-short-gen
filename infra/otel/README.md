# Observability: traces, errors and the audit log (E13-02)

Every publish can be explained from two places:

- **Audit log** (`audit_events`, append-only, always on): who asked, which assets went out with which licence, which
  checks passed (rights, variation, and whether a variation block was overridden), plus the job id and trace id.
  Read it with `explainPublish(db, publishId)` from `@shortloop/pipeline`.
- **Traces** (OpenTelemetry, optional export): the web request (`publish.request`), the queue hop and the worker
  (`job.publish`, attribute `shortloop.job_id`) share one trace id. The enqueuer's W3C `traceparent` travels in the
  job's input (`_traceparent`), so the worker continues the same trace across Redis/BullMQ.

Nothing leaves the process unless you set the variables below. Without them, spans still get trace ids (stored in the
audit log) but are not exported, and Sentry is never loaded.

| Variable                             | Where        | What                                                                                      |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | web + worker | OTLP/HTTP collector base URL, e.g. `https://otel.example.com` (traces go to `/v1/traces`) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | web + worker | full traces URL instead of the base URL above                                             |
| `OTEL_EXPORTER_OTLP_HEADERS`         | web + worker | auth for the collector, e.g. `x-honeycomb-team=...` or `Authorization=Basic ...`          |
| `SENTRY_DSN`                         | web + worker | report unexpected errors (failed jobs, server errors) to Sentry                           |
| `SHORTLOOP_ENV`                      | web + worker | environment name on spans and Sentry events (`staging`, `production`)                     |

## Pointing it at a collector

Any OTLP/HTTP endpoint works: a self-hosted OpenTelemetry Collector or Jaeger on Railway, or a hosted backend
(Grafana Cloud, Honeycomb, Axiom, ...). Example for Railway:

1. Pick a backend (owner decision; nothing is chosen yet) and create a project there.
2. On both the `web` and `worker` services set `OTEL_EXPORTER_OTLP_ENDPOINT` and, if the backend needs it,
   `OTEL_EXPORTER_OTLP_HEADERS`. Set `SHORTLOOP_ENV=staging`.
3. Redeploy. Publish a Short and search the backend for the publish job id (`shortloop.job_id`); the trace shows the
   web request and the worker run.

To try it locally, run a Jaeger all-in-one container and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

## Sentry

Create a Sentry project (Node platform), copy its DSN into `SENTRY_DSN` on `web` and `worker`. Sentry only reports
errors; tracing stays with OpenTelemetry (`enableOpenTelemetrySetup: false`).

## Code

- `packages/pipeline/src/tracing.ts`: `initTelemetry`, `withSpan`, `currentTraceparent`, `runWithTraceparent`, `reportError`.
- `packages/pipeline/src/audit.ts`: `recordAudit` (validated against the `AuditEvent` contract) and `explainPublish`.
- `apps/web/instrumentation.ts` and `apps/worker/src/main.ts` call `initTelemetry` at startup.
