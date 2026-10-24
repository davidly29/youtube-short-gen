# ShortLoop TypeScript SDK

Make, approve and publish original YouTube Shorts from your own code. Generated from the public API's OpenAPI spec
(`docs/api/openapi.yaml`), so every endpoint is a typed method. Works in Node 18+, Deno, Bun and edge runtimes (it only
needs `fetch` and Web Crypto).

## Five-minute quick-start

1. In ShortLoop, open **Settings → Developer** and create an API key (`sl_…`, shown once).
2. Run:

```ts
import { ShortLoop } from "@shortloop/sdk-ts";

const sl = new ShortLoop({ apiKey: process.env.SHORTLOOP_API_KEY, baseUrl: "https://<your app>/api/v1" });

const { project_id, job_id } = await sl.createShort({
  topic: "why octopuses have three hearts",
  length_seconds: 30,
});
const made = await sl.waitForJob(job_id); // holds each request up to 50 s on the server
console.log("watch it:", made.video_url);

await sl.approveShort(project_id); // only after a person has watched it
const pub = await sl.publishShort(project_id, { privacy: "private" });
console.log("on YouTube:", (await sl.waitForJob(pub.job_id)).url);
```

The same flow is in [`examples/quickstart.ts`](examples/quickstart.ts):
`SHORTLOOP_API_URL=… SHORTLOOP_API_KEY=… pnpm -F sdk-ts quickstart "your topic"` (publishes `private` unless
`SHORTLOOP_PRIVACY=public`).

## What you get

- One method per endpoint: `createShort`, `getJob`, `approveShort`, `publishShort`, `swapVisual`, `listVoices`,
  `listCaptionStyles`, `estimateCost`, `getBalance`, `getTrends`, `listWorkflows`, `getWorkflow`, `listWebhooks`,
  `createWebhook`, `deleteWebhook`, `listDeliveries`, `getOpenApi`. Request and response types are exported by name.
- `waitForJob(jobId)` returns the finished job, or throws `JobFailedError` (credits are refunded on failure).
- Errors are `ShortLoopError` with `status`, `code` (`unauthorized`, `invalid_request`, `rate_limited`, …) and the
  API's message. A `429` is retried after its `Retry-After` (twice by default, `maxRetries` to change).
- Webhooks: `await verifyWebhook(rawBody, req.headers.get("ShortLoop-Signature"), secret)` or `parseWebhook(…)`.
  Pass the raw body, before JSON parsing.

## Maintainers

`pnpm -F sdk-ts generate` rewrites `src/generated.ts` and the Python SDK's `shortloop/_generated.py` from the spec
(run it after `pnpm -F web openapi`). The tests fail if either file is stale, and check every request and response the
quick-start makes against the spec.
