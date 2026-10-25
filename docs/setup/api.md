# Public REST API and webhooks (E12-01)

The REST API lives at `/api/v1` in the web app. Every endpoint mirrors an MCP tool and calls the same service
functions, so credits, approvals, the rights check and the variation guard all apply the same way.

- Reference: [`docs/api/openapi.yaml`](../api/openapi.yaml) (OpenAPI 3.1), also served live at `/api/v1/openapi.json`.
  It's generated from `apps/web/src/server/api/spec.ts`; after changing an endpoint run `pnpm -F web openapi` and commit
  the file (the `api-contract` test fails if it's stale).
- Keys and webhooks: **Settings → Developer**. A key acts as the user who made it (their credits, their own AI keys, their
  channels). Only a SHA-256 hash of each key is stored; webhook signing secrets are sealed with `SHORTLOOP_SECRETS_KEY`.

## Nothing to set up for staging

No new accounts or secrets are needed. Optional env vars on `web`:

| Variable                    | Default | What it does                                                                           |
| --------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `API_RATE_LIMIT_PER_MINUTE` | `60`    | Requests per key per fixed one-minute window. Over it: `429` with `Retry-After`.       |
| `WEBHOOK_SENDER`            | unset   | `fake` records deliveries without sending them (local demos). Fake mode does the same. |

The rate-limit counter lives in Postgres (`api_rate_windows`), so it holds across several web instances.

## Try it

```sh
KEY=sl_...   # Settings → Developer → Create key
BASE=https://web-staging-0f0b5.up.railway.app/api/v1

curl -s -H "Authorization: Bearer $KEY" $BASE/balance
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"topic":"why octopuses have three hearts","length_seconds":30}' $BASE/shorts
curl -s -H "Authorization: Bearer $KEY" "$BASE/jobs/<job_id>?wait=50"
curl -s -X POST -H "Authorization: Bearer $KEY" $BASE/shorts/<project_id>/approve
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{}' $BASE/shorts/<project_id>/publish
```

## Webhooks

Events: `job.succeeded` (a Short finished rendering), `job.failed` (a production or publish failed for good) and
`publish.completed` (published or scheduled). Each is POSTed as JSON:

```json
{
  "id": "evt_…",
  "type": "job.succeeded",
  "created_at": "2026-10-23T10:00:00.000Z",
  "data": { "job_id": "job_…", "kind": "production", "project_id": "prj_…", "status": "ready" }
}
```

Headers: `ShortLoop-Event`, `ShortLoop-Delivery` and `ShortLoop-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is
HMAC-SHA256 of `"<t>.<raw body>"` keyed with the webhook's secret. Verify it in constant time and reject timestamps
more than 5 minutes old (Node: `verifyWebhookSignature` in `packages/providers/src/webhooks`).

How delivery works:

- The web process looks for new events every 15 s and right after any job finishes. Events come from finished jobs
  and publish records, so nothing is lost if the process restarts. Only events from the last 24 hours, and from
  after the webhook was added, are sent.
- Any 2xx within 10 s counts as delivered. Otherwise it's retried after 1 min, 5 min, 30 min, 2 h and 6 h, then marked
  failed. The payload `id` stays the same across retries; use it to drop duplicates.
- Receivers must be public `https://` URLs. Private, loopback and link-local hosts are refused when the webhook is
  saved and again at send time (after DNS), redirects aren't followed, and the response body is never read.
- Settings → Developer shows the last five deliveries per webhook; `GET /webhooks/{id}/deliveries` lists 50.
