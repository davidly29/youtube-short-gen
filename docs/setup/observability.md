# Traces and error reporting (optional)

ShortLoop runs fine without any of this: the audit log that explains every publish is always written to Postgres.
Exporting traces and reporting errors are off until you set these variables on **both** the `web` and `worker`
services (never in the repo):

| Variable                      | Example                    | Effect                                                              |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otel.example.com` | Send traces (web request → queue → worker) to an OTLP/HTTP backend. |
| `OTEL_EXPORTER_OTLP_HEADERS`  | `x-api-key=...`            | Auth headers the backend asks for.                                  |
| `SENTRY_DSN`                  | from your Sentry project   | Report failed jobs and server errors to Sentry.                     |
| `SHORTLOOP_ENV`               | `staging`                  | Environment name on traces and Sentry events.                       |

Owner steps (not needed to build or test): choose a trace backend and create a Sentry project. Details, and how to
find a publish's trace by its job id, are in [infra/otel/README.md](../../infra/otel/README.md).
