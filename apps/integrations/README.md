# ShortLoop integrations (E12-03)

Three ways to use ShortLoop from tools people already work in. All of them call the public REST API
([docs/setup/api.md](../../docs/setup/api.md)) with the user's own `sl_…` key, so credits, approvals, the rights check
and the variation guard apply exactly as in the web app. Nothing here runs on ShortLoop's servers.

| Integration                 | What users get                                                                                    | Source                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Zapier**                  | Triggers _Short Rendered_ (REST hook) and _New Brief Idea_ (polling); action _Create Short_       | `src/zapier/app.ts`                     |
| **Make**                    | _Watch Rendered Shorts_ (instant), _Watch Brief Ideas_ (polling), _Create a Short_, _Get a Short_ | `src/make/app.ts` → `make/`             |
| **Content-calendar import** | One Short per row of a Google Sheet, a Notion database or a CSV export, with errors shown per row | `src/calendar/*`, CLI `import:calendar` |

The _Create Short_ fields are shared (`src/fields.ts`) and tested against the API's `create_short` schema, so the
three can't drift from the API or from each other.

## Marketplace review checklists

`pnpm -F integrations test` runs each marketplace's checks against the real definitions, so a broken app fails CI
before anyone submits it (same approach as the MCP directory listings in `apps/mcp/listing`).

**Zapier** (`checkZapier`, `src/zapier/checklist.ts`)

1. The definition validates against `zapier-platform-schema` 19.2.1, the schema `zapier validate` uses.
2. Authentication has a test call (`GET /account`), a connection label, and help text saying where to get the key.
3. Visible triggers/actions have a noun, a Title Case label, and a description starting "Triggers when…"/"Creates…".
4. Every trigger and action has a static sample and output fields, and the sample covers every output field.
5. Trigger samples have an `id` (Zapier dedupes polling triggers on it: we use `topic_id` and `project_id`).
6. The REST hook has performSubscribe, performUnsubscribe and a performList fallback for testing.
7. Dynamic dropdowns (voices, channels) point at hidden triggers, and every hidden trigger is used.
8. Every input field has a label and help text; required fields come first.
9. Semver app version; `platformVersion` matches the schema we validate against.

Also tested: the built bundle is self-contained CommonJS (no workspace or zod imports) and passes the same checks.

**Make** (`checkMake`, `src/make/checklist.ts`)

1. Lower-case app name, label, description, semver version.
2. Base: URL from the connection, API errors mapped to a readable message (401 and 429 typed), auth header
   sanitized from logs.
3. Connection validated with `GET /account`, labelled with the account name; the key is a password field.
4. Make's naming: "Watch …" triggers and "Create …"/"Get …" actions in Title Case; descriptions start
   "Triggers when…"/"Creates…"/"Returns…".
5. Every module has an output interface and samples covering it.
6. The polling trigger has a Limit parameter wired to the response and dedupes on `topic_id`.
7. The instant trigger uses a dedicated webhook attached (`POST /webhooks`) and detached (`DELETE`) through the API.
8. Every parameter has help; every `rpc://` dropdown exists and every RPC is used.
9. Templates only read variables that exist where they're used, and only use the IML subset the tests can evaluate.

Each check also lists what only the owner can provide (accounts, logo, legal pages, a reviewer test account): see
"Before submitting" in [docs/setup/integrations.md](../../docs/setup/integrations.md).

## Commands

```sh
pnpm -F integrations test                 # all of the above
pnpm -F integrations build:zapier         # bundle the Zapier app into dist/zapier, ready for `zapier push`
pnpm -F integrations build:make           # regenerate make/*.json after changing src/make/app.ts
pnpm -F integrations import:calendar --csv calendar.csv           # dry run: checks every row, creates nothing
pnpm -F integrations import:calendar --sheet <spreadsheet id> --yes
pnpm -F integrations import:calendar --notion <database id> --from today --yes
```
