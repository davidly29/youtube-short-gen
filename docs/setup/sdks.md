# SDKs and MCP directory listings (E12-02)

**SDKs.** `packages/sdk-ts` (`@shortloop/sdk-ts`) and `packages/sdk-py` (`shortloop`) are generated from
`docs/api/openapi.yaml` by `pnpm -F sdk-ts generate`. Both read two variables on the developer's machine (not ours):

| Variable            | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `SHORTLOOP_API_URL` | `https://<app>/api/v1`                                      |
| `SHORTLOOP_API_KEY` | an `sl_…` key from Settings → Developer                     |
| `SHORTLOOP_PRIVACY` | quick-start only: `private` (default), `unlisted`, `public` |

**Run the quick-start against staging** (publishes a private Short to the key owner's connected channel and uses 1
credit): create a key on staging as a user with a connected YouTube channel and an AI key (or an access code), then

```bash
SHORTLOOP_API_URL=https://web-staging-0f0b5.up.railway.app/api/v1 SHORTLOOP_API_KEY=sl_... pnpm -F sdk-ts quickstart
```

CI doesn't do this yet: it needs a staging key as a repository secret and a CI job, which is an owner decision (see PR).

**Publishing the SDKs** to npm and PyPI is an owner step (accounts, package names). Until then they install from the
repo.

**MCP directories.** See `apps/mcp/listing/README.md`: `pnpm -F mcp build:listing` writes `server.json` for the
official MCP Registry (`SHORTLOOP_PUBLIC_URL` overrides the staging origin at build time), and the listing tests run
each directory's checks.
