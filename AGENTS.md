# AGENTS.md: rules for every coding agent (and human) in this repo

ShortLoop is an original-content Shorts studio: trend → original script → voice + rights-clean visuals → captions → publish → learn.
The full plan, roadmap and backlog live in [docs/business-plan.md](docs/business-plan.md). The working POC lives in
[poc/opengen-mcp](poc/opengen-mcp) and is **reference only**: copy ideas from it, never import it.

## How work flows here

1. Work comes only from GitHub issues labelled `agent-ready`. Pick the lowest-numbered one in the earliest open milestone
   whose **Depends on** issues are all closed. Label it `in-progress` and assign nothing else to yourself.
2. Branch: `agent/<ticket-id>-<short-slug>` (e.g. `agent/E0-02-core-contracts`) from the latest default branch.
3. Build exactly what the ticket says, inside its **Touches** paths. Anything else you notice becomes a new issue labelled `agent-proposed`.
4. Open a PR using the template, titled `<ticket-id>: <title>`, body containing `Closes #<issue>` and the real test output.
5. **Never merge. Never push to `master`. One ticket per PR.** The owner (@davidly29) reviews and merges.
6. Stop and ask instead of guessing: if acceptance criteria conflict, are ambiguous, or the work needs a product, pricing,
   billing, legal, rights or platform-policy decision, comment on the issue with the question and options, label it
   `needs-human`, and stop. If you're stuck on tests, push the branch, open a **draft** PR explaining the blocker, and label the issue `blocked`.

## Hard rules

- Never download or ingest media from YouTube, TikTok, Instagram, Facebook, X, Twitch or similar platforms. Sources are user uploads
  (with ownership attestation), the user's own channel via official APIs, licensed stock APIs, and AI providers.
- Never commit secrets, API keys, tokens or `.env` files. Tests use fake providers; no real network calls in tests.
- Keep the default branch green. If CI is red on the default branch, fix that first (as its own PR).
- Prefer small PRs (< ~600 changed lines excluding lockfiles and fixtures). Split a ticket into sub-PRs if needed and say so on the issue.

## Working agreement (from the business plan)

One TypeScript monorepo, strict contracts in a shared package, and tickets small enough that an agent can finish one in a single session with tests passing. Put this section into the repo as `AGENTS.md` (and `CLAUDE.md`) so every coding agent reads it first.

**Stack (decided; change only by ADR)**

| Concern        | Choice                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Monorepo       | pnpm workspaces + Turborepo, Node 22, TypeScript strict                      |
| Web app        | Next.js (App Router), Tailwind, shadcn/ui                                    |
| API            | Next.js route handlers + tRPC for the app; REST (OpenAPI) for the public API |
| Database       | Postgres + Drizzle ORM; migrations in `packages/db`                          |
| Jobs           | BullMQ on Redis; one queue per pipeline stage                                |
| Media          | FFmpeg in worker containers; Remotion for caption/compose templates          |
| Storage        | S3-compatible (Cloudflare R2), signed URLs only                              |
| AI providers   | Behind `packages/providers` adapters: LLM, TTS, image, video, stock, ASR     |
| Auth / billing | Better Auth (email + Google) · Stripe Billing with metered credits           |
| MCP            | `@modelcontextprotocol/sdk`, Streamable HTTP, OAuth 2.1                      |
| Tests          | Vitest (unit), Playwright (e2e), golden-file render tests                    |

**Repo layout**

```
apps/
  web/            Next.js app (UI + tRPC)
  worker/         BullMQ workers, one file per stage
  mcp/            MCP server
packages/
  contracts/      Zod schemas: Project, Asset, Script, Timeline, Job, PublishTarget
  db/             Drizzle schema + migrations
  providers/      Adapters with a fake implementation each (for tests)
  render/         Remotion compositions + FFmpeg helpers
  pipeline/       Pure functions per stage (no I/O)
  ui/             Shared components
docs/adr/         Architecture decision records
AGENTS.md         This agreement
```

**Ticket template (every backlog item uses it)**

```markdown
### <ID> <Title>

Intent: <one sentence on the user/business outcome>
Depends on: <ticket IDs or none>
Touches: <paths an agent may create or edit>
Interface: <function signatures, routes, Zod types, events>
Build: <numbered steps, no ambiguity>
Acceptance:

- [ ] <observable, testable statement>
      Test: <exact command, e.g. pnpm -F worker test render>
      Out of scope: <what NOT to build>
```

**Definition of done (agents check all before opening a PR)**

- [ ] Every acceptance box is covered by an automated test that passes in CI
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; no new `any`
- [ ] External calls go through `packages/providers` with a fake used in tests; no real API keys in tests
- [ ] Schema changes come with a Drizzle migration and updated Zod contract
- [ ] PR description restates the intent, lists files touched, and pastes the test output
- [ ] Edits stay inside the ticket's _Touches_ list; anything else becomes a new ticket

**Rules for agents**

1. Read `AGENTS.md`, the ticket, and the contracts it names before writing code.
2. Contracts first: if an interface is missing, add it to `packages/contracts` in its own commit.
3. Never fetch media from YouTube, TikTok or any third-party site; sources are uploads, own-channel API, stock APIs or AI providers.
4. Stop and ask (open a draft PR with a question) when acceptance criteria conflict or a decision affects billing, rights or publishing.
