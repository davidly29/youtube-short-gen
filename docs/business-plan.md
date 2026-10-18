# ShortLoop Business Plan, Roadmap & Agent-Ready Backlog

As of 15 Oct 2026 · Owner: David

## Executive summary

ShortLoop is an **original-content Shorts studio** that turns a rising trend into a published, monetisable 9:16 video in under 15 minutes, using only rights-clean inputs: the creator's own footage, AI-generated visuals, licensed stock and synthetic voice. It is sold as a web app and as an MCP server that Claude, ChatGPT and Cursor users can drive directly.

**The gap.** Clippers (OpusClip, Vizard, Klap) need a long video you already own. Generators (Everygen, VideoGen) need you to bring the idea and the URL, and neither publishes. Nobody closes the loop *trend → original script → video → publish → performance → better next video*, and nobody makes "stays monetisable under YouTube's inauthentic-content rules" a product promise.

**The product.** Five things competitors split across three tools: trend briefs per niche, original scripting in the creator's voice, AI/stock visual assembly with captions, one-click publishing to YouTube (then TikTok and Instagram), and a learning loop that tunes hooks and formats from each channel's own retention data.

**The plan.** 12 weeks to a YouTube-only MVP with a team of 3–4 plus coding agents, public trend-to-publish loop by month 6, agency tier and public API by month 12. Every backlog item below is written as a self-contained agent task with an intent, interfaces, acceptance criteria and a test command.

**Targets (to validate in phase 0):** 300 paying creators and ~$15k MRR by month 12, gross margin above 60% after AI costs.

## The gap in the market

Every competitor either needs footage you already own or stops before publishing; the trend-led, publish-and-learn quadrant is empty, and it is the one YouTube's 2026 monetisation rules reward.

> Diagram: market map · starting point × how far the tool goes (see the live doc for the drawing).

The bottom-left is a price war. The top-right is defensible because each channel's performance data compounds into better briefs and scripts that a newcomer cannot copy.

## Product and customers

We sell finished, original Shorts per day, not editing minutes. The beachhead is faceless and semi-faceless educational/news-commentary channels, because they publish daily, feel the monetisation squeeze most, and need no footage of their own.

| Segment | Job to be done | Why they switch | Tier |
| --- | --- | --- | --- |
| Faceless niche channels (tech, finance explainers, history, science) | Publish 1–3 original Shorts a day on what's trending in their niche | Current stacks (ChatGPT + ElevenLabs + CapCut + manual upload) take 1–2 h per Short | Creator / Pro |
| Talking-head creators with long-form | Turn their own videos *plus* trending angles into Shorts | Clippers only re-cut; we add trend-led new scripts in their voice | Pro |
| Small agencies managing 5–30 channels | Volume with brand control and approvals | Multi-channel workspaces, approvals, per-client brand kits | Agency |
| Builders and AI-agent users | Call video creation from Claude, Cursor or their own agent | MCP + API with publish, which Everygen and VideoGen lack | API / usage |

**Core loop (the product in one line):** pick niche → daily trend brief → choose angle → original script in channel voice → voice + AI/stock visuals + captions → review → publish → retention data tunes the next brief.

**Rights-clean by construction.** Ingest accepts only: user uploads the user attests they own, the user's own YouTube channel, licensed stock APIs (e.g. Pexels/Pixabay/Storyblocks), AI-generated media, and the platform's own music library. Every asset carries a licence record that ships with the export.

**Go-to-market**

1. *Build in public on Shorts itself:* run 3 house channels made only with ShortLoop and publish their growth numbers.
2. *MCP directories and Claude/ChatGPT connector listings* for the agent segment.
3. *Creator communities* (faceless-YouTube Discords, Reddit, Skool groups) with a free tier and templates.
4. *Affiliate programme* at 30% recurring for creator-educators.
5. *Agency outbound* from month 6 with case studies from the house channels.

## Business model

Subscription priced per finished Short with a credit pool for expensive generative video; the default stock + AI-image path keeps cost per Short around $0.30, so tiers clear 60%+ gross margin.

| Tier | Price / month | Includes | Est. AI cost at full use | Gross margin |
| --- | --- | --- | --- | --- |
| Free | $0 | 5 Shorts, watermark, 1 channel, no auto-publish | ~$1.50 | n/a (acquisition) |
| Creator | $29 | 30 Shorts, 1 channel, daily trend brief, YouTube publish | ~$9 | ~69% |
| Pro | $79 | 90 Shorts, 3 channels, all platforms, 20 AI-video credits, voice clone | ~$30 | ~62% |
| Agency | $299 | 400 Shorts, 15 channels, approvals, brand kits, seats | ~$120 | ~60% |
| API / MCP usage | Per Short ($0.60) + per AI-video second | Metered, no seat | ~$0.30 | ~50% |

**Cost per Short (approximate, 45-second Short, to verify with vendor quotes):** script and brief LLM calls ~$0.02 · TTS ~$0.08 · 6–8 AI images or stock clips ~$0.15 · render and storage ~$0.03 · total ~$0.30. Adding two 5-second generative video shots adds roughly $0.50–1.50, which is why those sit behind credits.

**KPIs we run the company on**

- *Activation:* % of sign-ups who publish a Short within 24 h (target 40%).
- *Habit:* Shorts published per active channel per week (target 5+).
- *Outcome:* median views per Short vs the channel's pre-ShortLoop baseline.
- *Safety:* % of channels with any monetisation or reused-content flag (target under 1%).
- *Unit economics:* AI cost per Short and gross margin per tier, monthly.

**12-month targets (assumptions to test)**

| Quarter | Milestone | Paying customers | MRR |
| --- | --- | --- | --- |
| Q1 (Nov 2026–Jan 2027) | MVP live, YouTube publishing, 3 house channels | 30 beta | $1k |
| Q2 (Feb–Apr 2027) | Trend loop + TikTok/IG public | 120 | $5k |
| Q3 (May–Jul 2027) | Agency tier, learning loop | 220 | $10k |
| Q4 (Aug–Oct 2027) | Public API, partner integrations | 300 | $15k |

## Executive roadmap

Four lanes move together each quarter, and each quarter ends at a gate the business must pass before the next quarter's spend is committed.

> Diagram: executive roadmap · 4 lanes × 4 quarters, 4 gates (see the live doc for the drawing).

| Gate | When | Pass criteria | If it fails |
| --- | --- | --- | --- |
| Beta users publish | end Jan 2027 | 30 beta users each publish 3+ Shorts; median time to first publish under 15 min | Extend MVP by one sprint; cut scope, not quality |
| Audits passed | end Apr 2027 | TikTok Content Posting audit and Instagram app review approved; YouTube quota extension granted | Launch publicly with YouTube only; keep TikTok private-post beta |
| Retention lift | end Jul 2027 | Channels using recommendations show higher median avg-view % than their own baseline | Keep recommender opt-in; shift Q4 effort to agency features |
| API GA | end Oct 2027 | API uptime 99.5% for 30 days; 10 paying API workspaces | Keep API in beta, prioritise MCP directory distribution |

## Agile delivery plan

Two-week sprints starting Monday 19 October 2026; each sprint has one goal tied to a roadmap objective, and a sprint closes only when its demo runs end-to-end on staging. Humans own sprint goals, review and merge; agents pick up tickets from the backlog below in dependency order.

**Roadmap objectives**

- **O1 MVP:** a user can generate an original Short from a topic and publish it to YouTube (Q1).
- **O2 Trend loop:** daily niche trend briefs feed scripts automatically (Q2).
- **O3 Multi-platform:** public posting to TikTok and Instagram after audits (Q2).
- **O4 Learning loop:** channel analytics improve hook and format choice (Q3).
- **O5 Agency:** multi-channel workspaces, approvals, seats (Q3).
- **O6 Platform:** public API, MCP GA, partner integrations (Q4).

| Sprint | Dates | Sprint goal | Objective | Tickets |
| --- | --- | --- | --- | --- |
| S0 | 19–30 Oct 2026 | Repo, CI, infra and a hard-coded Short renders in the cloud | O1 | E0-01…E0-05 |
| S1 | 2–13 Nov | Users sign in, upload assets with licence records, see a library | O1 | E1-01, E1-02, E2-01…E2-03 |
| S2 | 16–27 Nov | Topic → script → voiceover → stock/AI visuals | O1 | E4-01, E4-02, E5-01…E5-03 |
| S3 | 30 Nov–11 Dec | Timeline render with captions; review and edit screen | O1 | E6-01…E6-03, E7-01, E7-02 |
| S4 | 14–23 Dec | YouTube OAuth + publish + schedule; billing | O1 | E8-01, E8-02, E1-03 |
| S5 | 4–15 Jan 2027 | MCP server v1, hardening, beta launch 18 Jan | O1 | E9-01, E9-02, E13-01, E13-02 |
| S6–S7 | 18 Jan–12 Feb | Trend radar and daily brief | O2 | E3-01…E3-04 |
| S8–S9 | 15 Feb–12 Mar | TikTok and Instagram publishing (audits filed in S0) | O3 | E8-03, E8-04 |
| S10–S11 | 15 Mar–9 Apr | Channel style + public launch | O2 | E4-03, E13-03 |
| S12–S14 | 12 Apr–21 May | Analytics ingest and ranking loop | O4 | E10-01…E10-03 |
| S15–S17 | 24 May–2 Jul | Agency workspaces and approvals | O5 | E11-01…E11-03 |
| S18–S23 | 5 Jul–24 Sep | Public API, MCP GA, integrations | O6 | E12-01…E12-03 |

**Ceremonies, kept light for a human + agent team:** Monday planning (30 min: pick the goal, order tickets, assign to agents); daily async check-in in the tracker; Thursday demo on staging; Friday review of agent PRs and backlog grooming (write the next sprint's tickets to the template in the next section).

## Agent working agreement

One TypeScript monorepo, strict contracts in a shared package, and tickets small enough that an agent can finish one in a single session with tests passing. Put this section into the repo as `AGENTS.md` (and `CLAUDE.md`) so every coding agent reads it first.

**Stack (decided; change only by ADR)**

| Concern | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo, Node 22, TypeScript strict |
| Web app | Next.js (App Router), Tailwind, shadcn/ui |
| API | Next.js route handlers + tRPC for the app; REST (OpenAPI) for the public API |
| Database | Postgres + Drizzle ORM; migrations in `packages/db` |
| Jobs | BullMQ on Redis; one queue per pipeline stage |
| Media | FFmpeg in worker containers; Remotion for caption/compose templates |
| Storage | S3-compatible (Cloudflare R2), signed URLs only |
| AI providers | Behind `packages/providers` adapters: LLM, TTS, image, video, stock, ASR |
| Auth / billing | Better Auth (email + Google) · Stripe Billing with metered credits |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP, OAuth 2.1 |
| Tests | Vitest (unit), Playwright (e2e), golden-file render tests |

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
- [ ] Edits stay inside the ticket's *Touches* list; anything else becomes a new ticket

**Rules for agents**

1. Read `AGENTS.md`, the ticket, and the contracts it names before writing code.
2. Contracts first: if an interface is missing, add it to `packages/contracts` in its own commit.
3. Never fetch media from YouTube, TikTok or any third-party site; sources are uploads, own-channel API, stock APIs or AI providers.
4. Stop and ask (open a draft PR with a question) when acceptance criteria conflict or a decision affects billing, rights or publishing.

## Agent-ready backlog

Each ticket below is a complete agent prompt: paste it with `AGENTS.md` and the agent has the intent, the files it may touch, the interface to honour and the test that proves it is done. Tickets are listed in build order; IDs map to the sprint table above.

| Epic | Name | Objective | Tickets |
| --- | --- | --- | --- |
| E0 | Foundation | O1 | 5 |
| E1 | Accounts and billing | O1 | 3 |
| E2 | Assets and rights ledger | O1 | 3 |
| E4 | Scripting | O1, O2 | 3 |
| E5 | Voice and visuals | O1 | 3 |
| E6 | Render and captions | O1 | 3 |
| E7 | Review editor | O1 | 2 |
| E8 | Publishing | O1, O3 | 4 |
| E9 | MCP server | O1, O6 | 2 |
| E13 | Safety and compliance | O1, O2 | 3 |
| E3 | Trend radar | O2 | 4 |
| E10 | Analytics and learning | O4 | 3 |
| E11 | Agency | O5 | 3 |
| E12 | Public platform | O6 | 3 |

### E0 Foundation

#### E0-01 Monorepo scaffold and CI

**Intent:** every later ticket lands in a repo that lints, type-checks and tests on each PR.

**Depends on:** none

**Touches:** repo root, `apps/*`, `packages/*`, `.github/workflows/ci.yml`

**Build:**

1. Create the layout in *Agent working agreement* with pnpm workspaces and Turborepo.
2. Add shared `tsconfig` (strict), ESLint, Prettier, Vitest config.
3. CI workflow: install, `pnpm lint`, `pnpm typecheck`, `pnpm test` on Node 22.
4. Commit `AGENTS.md` and `CLAUDE.md` with the agreement text.

**Acceptance:**

- [ ] `pnpm i && pnpm lint && pnpm typecheck && pnpm test` passes on a clean clone
- [ ] CI runs on pull requests and fails on a deliberate type error

**Test:** `pnpm turbo run lint typecheck test`

**Out of scope:** deployment, Docker.

#### E0-02 Core contracts

**Intent:** one source of truth for data shapes so agents working in parallel stay compatible.

**Depends on:** E0-01

**Touches:** `packages/contracts/src/*`

**Interface (Zod, exported types of the same name):**

- `Asset { id, ownerId, kind: 'video'|'image'|'audio', source: 'upload'|'own_channel'|'stock'|'ai_generated'|'library_music', licence: Licence, storageKey, durationMs?, width?, height?, createdAt }`
- `Licence { type: 'owned'|'stock'|'ai_generated'|'library', provider?, licenceUrl?, attribution?, attestedByUserAt? }`
- `Script { id, projectId, title, hook, beats: Beat[], cta, language, wordCount }` · `Beat { id, text, visualQuery, estDurationMs }`
- `Timeline { id, fps: 30, width: 1080, height: 1920, durationMs, video: Clip[], audio: AudioClip[], captions: CaptionWord[], captionStyle }`
- `Clip { assetId, startMs, endMs, srcInMs, fit: 'cover'|'contain', motion: 'none'|'kenburns' }` · `AudioClip { assetId, startMs, endMs, gainDb }` · `CaptionWord { text, startMs, endMs, emphasis: boolean }`
- `Job { id, type, status: 'queued'|'running'|'succeeded'|'failed'|'cancelled', progress, input, output?, error?, costCredits, idempotencyKey }`
- `PublishRequest { platform: 'youtube'|'tiktok'|'instagram', accountId, videoAssetId, title, description, tags, privacy, scheduledAt?, aiDisclosure: boolean }`

**Acceptance:**

- [ ] Each schema has a valid and an invalid fixture test
- [ ] `Timeline` rejects clips that overlap on the video track or exceed `durationMs`
- [ ] Total Short duration is capped at 180 000 ms

**Test:** `pnpm -F contracts test`

**Out of scope:** database mapping (E0-03).

#### E0-03 Database schema and migrations

**Intent:** persist users, projects, assets, scripts, timelines, jobs and publish records.

**Depends on:** E0-02

**Touches:** `packages/db/*`

**Build:**

1. Drizzle tables mirroring the contracts plus `users`, `channels`, `projects`, `publish_records`, `credit_ledger`.
2. `credit_ledger` is append-only (`delta`, `reason`, `jobId`); balance = sum.
3. Seed script with one user, one project, three stock assets.

**Acceptance:**

- [ ] `pnpm -F db migrate` runs on an empty Postgres and is idempotent
- [ ] Round-trip test: insert and read each entity, validated by its Zod schema

**Test:** `pnpm -F db test` (uses Testcontainers Postgres)

**Out of scope:** row-level security.

#### E0-04 Job queue and worker skeleton

**Intent:** every slow operation runs as a resumable, idempotent, metered job.

**Depends on:** E0-03

**Touches:** `apps/worker/*`, `packages/pipeline/src/jobs.ts`

**Interface:** `enqueue(type, input, { idempotencyKey, ownerId }): Promise<Job>` · `onProgress(jobId, 0..1)` · events `job.updated` on Redis pub/sub.

**Build:**

1. BullMQ queues: `script`, `voice`, `visuals`, `render`, `publish`, `trends`.
2. Same idempotency key returns the existing job, never a second one.
3. On failure after 3 retries: status `failed`, credits refunded via `credit_ledger`.

**Acceptance:**

- [ ] Duplicate enqueue with same key returns the same job id
- [ ] A failing handler ends `failed` with a refund row
- [ ] Progress events reach a subscriber in order

**Test:** `pnpm -F worker test jobs`

**Out of scope:** autoscaling.

#### E0-05 Render smoke test in the cloud

**Intent:** prove the media stack works before features depend on it.

**Depends on:** E0-04

**Touches:** `packages/render/*`, `apps/worker/src/render.ts`, `infra/`

**Build:**

1. Remotion composition `ShortV1` rendering a `Timeline` (images + one audio track) at 1080x1920, 30 fps, H.264/AAC.
2. Worker renders a fixture timeline and uploads the MP4 to R2.
3. Golden test: frame at 1 s matches a stored PNG within tolerance.

**Acceptance:**

- [ ] Fixture renders in under 60 s on the worker container
- [ ] Output passes `ffprobe` checks: 9:16, 30 fps, H.264, AAC, duration ±100 ms

**Test:** `pnpm -F render test golden`

**Out of scope:** captions (E6-02).

### E1 Accounts and billing

#### E1-01 Sign-in and workspace

**Intent:** a creator can sign up and land in their own workspace.

**Depends on:** E0-03

**Touches:** `apps/web/app/(auth)/*`, `apps/web/lib/auth.ts`

**Build:** Better Auth with email magic link and Google; on first sign-in create a personal workspace and grant 5 free Shorts of credit.

**Acceptance:**

- [ ] New user sees an empty project list after sign-in
- [ ] `credit_ledger` has a +5 Short grant with reason `signup`

**Test:** `pnpm -F web e2e auth`

**Out of scope:** teams (E11-01).

#### E1-02 Credits service

**Intent:** one place decides whether an action is affordable and charges for it.

**Depends on:** E0-04

**Touches:** `packages/pipeline/src/credits.ts`

**Interface:** `estimate(plan: JobPlan): Credits` · `reserve(ownerId, credits, jobId)` · `settle(jobId, actual)` · `refund(jobId)`

**Acceptance:**

- [ ] Reserve fails with `INSUFFICIENT_CREDITS` when balance is too low
- [ ] Settle charges actual cost and releases the remainder
- [ ] Concurrent reserves never overdraw (property test, 100 parallel calls)

**Test:** `pnpm -F pipeline test credits`

**Out of scope:** Stripe (E1-03).

#### E1-03 Stripe subscriptions

**Intent:** users can pay for Creator and Pro, and monthly credits top up automatically.

**Depends on:** E1-02

**Touches:** `apps/web/app/api/stripe/*`, `apps/web/app/(app)/billing/*`

**Build:** Stripe Checkout for tiers in *Business model*; webhook on `invoice.paid` grants the tier's monthly Shorts and AI-video credits; Customer Portal link for cancel/upgrade.

**Acceptance:**

- [ ] Test-mode checkout grants credits once per invoice (webhook replay is idempotent)
- [ ] Cancelled subscription stops new grants but keeps unspent credits to period end

**Test:** `pnpm -F web test stripe` (Stripe CLI fixtures)

**Out of scope:** Agency invoicing.

### E2 Assets and rights ledger

#### E2-01 Upload with ownership attestation

**Intent:** users add their own media, and every file is recorded as theirs by attestation.

**Depends on:** E0-03, E1-01

**Touches:** `apps/web/app/(app)/library/*`, `apps/web/app/api/upload/*`

**Build:** signed multipart upload to R2; a required checkbox "I own or have rights to this media" stored as `licence.attestedByUserAt`; probe with FFmpeg to fill duration and size.

**Acceptance:**

- [ ] Upload without attestation is rejected server-side
- [ ] MP4, MOV, PNG, JPG, MP3, WAV accepted; others rejected with a clear error
- [ ] Files over 2 GB rejected before upload starts

**Test:** `pnpm -F web e2e upload`

**Out of scope:** own-channel import (Q2).

#### E2-02 Stock media provider adapter

**Intent:** scripts can be illustrated with licensed stock without users hunting for footage.

**Depends on:** E0-02

**Touches:** `packages/providers/src/stock/*`

**Interface:** `searchStock({ query, kind, orientation: 'portrait', minDurationMs? }): StockResult[]` · `importStock(result, ownerId): Asset` (source `stock`, licence with provider + URL + attribution).

**Build:** Pexels adapter first, Pixabay second; plus a `FakeStock` for tests.

**Acceptance:**

- [ ] Imported assets always carry provider, licence URL and attribution text
- [ ] Portrait results are preferred; landscape results are flagged `needsCrop`

**Test:** `pnpm -F providers test stock`

**Out of scope:** paid stock libraries.

#### E2-03 Rights manifest on export

**Intent:** every rendered Short can prove where each piece came from.

**Depends on:** E2-01, E2-02

**Touches:** `packages/pipeline/src/rights.ts`

**Interface:** `buildRightsManifest(timeline): RightsManifest` listing each asset, source, licence, attribution; `assertPublishable(manifest)` throws if any asset lacks a licence or comes from a disallowed source.

**Acceptance:**

- [ ] Manifest JSON is stored beside every render
- [ ] Attribution text is auto-appended to the publish description when a licence requires it
- [ ] A timeline containing an asset with no licence cannot be published

**Test:** `pnpm -F pipeline test rights`

**Out of scope:** audio fingerprinting (E13-03).

### E4 Scripting

#### E4-01 Topic to original script

**Intent:** a user types a topic or picks a trend and gets an original, hook-first Short script they can publish as their own.

**Depends on:** E0-02, E0-04

**Touches:** `packages/pipeline/src/script.ts`, `packages/providers/src/llm/*`, `apps/worker/src/script.ts`

**Interface:** `generateScript({ topic, angle?, targetSeconds: 30|45|60, tone, language, channelStyle? }): Script`

**Build:**

1. LLM call with structured output validated by the `Script` schema; retry once on schema failure.
2. Prompt rules: hook in the first sentence (≤ 12 words), 4–8 beats, one idea per beat, a `visualQuery` per beat, no claims presented as fact without a `[verify]` tag, no named real people quoted.
3. Word count targets 2.6 words/second of `targetSeconds` ±10%.

**Acceptance:**

- [ ] 20 fixture topics produce schema-valid scripts with the fake LLM and with a recorded real-LLM cassette
- [ ] Word count within ±10% of target in all 20
- [ ] Every beat has a non-empty `visualQuery`

**Test:** `pnpm -F pipeline test script`

**Out of scope:** channel style learning (E4-03).

#### E4-02 Script variation guard

**Intent:** keep users clear of YouTube's "templated, mass-produced" demonetisation by preventing near-duplicate Shorts.

**Depends on:** E4-01

**Touches:** `packages/pipeline/src/variation.ts`

**Interface:** `similarity(script, recentScripts[]): number` (embedding cosine) · `checkVariation(channelId, script): { ok, nearest?, score }`

**Acceptance:**

- [ ] Scripts with cosine ≥ 0.9 to any of the channel's last 50 are blocked with a reason shown in the UI
- [ ] Hooks reused verbatim within 30 days are flagged
- [ ] Blocking can be overridden only by an explicit user action that is logged

**Test:** `pnpm -F pipeline test variation`

**Out of scope:** cross-user checks.

#### E4-03 Channel voice profile (Q2)

**Intent:** scripts sound like the creator, which raises retention and keeps content clearly authored.

**Depends on:** E4-01, E8-01

**Touches:** `packages/pipeline/src/style.ts`, `apps/worker/src/style.ts`

**Interface:** `buildStyleProfile(channelId): StyleProfile { vocabulary, sentenceLength, hookPatterns[], bannedPhrases[], examples[] }` from the user's own published titles, descriptions and caption tracks fetched via the YouTube Data API with their OAuth token.

**Acceptance:**

- [ ] Profile builds from ≥ 10 of the user's own videos and is editable in settings
- [ ] `generateScript` with a profile scores higher on a style-match eval than without (LLM-judge, 20 fixtures)

**Test:** `pnpm -F pipeline test style`

**Out of scope:** using other channels' content.

### E5 Voice and visuals

#### E5-01 Voiceover with word timings

**Intent:** every script becomes natural narration whose word timings drive captions and cuts.

**Depends on:** E4-01

**Touches:** `packages/providers/src/tts/*`, `apps/worker/src/voice.ts`

**Interface:** `synthesize({ text, voiceId, speed }): { audioAsset: Asset, words: CaptionWord[] }`

**Build:** ElevenLabs-class adapter that returns character or word alignment; fall back to forced alignment with Whisper when a provider returns none; normalise loudness to −14 LUFS.

**Acceptance:**

- [ ] Word timings are monotonic and within 80 ms of a forced-alignment reference on 5 fixtures
- [ ] Output loudness is −14 ±1 LUFS
- [ ] Voice library lists only voices with commercial-use rights

**Test:** `pnpm -F worker test voice`

**Out of scope:** voice cloning (Pro, later).

#### E5-02 Beat-to-visual matcher

**Intent:** each beat gets a relevant, rights-clean visual automatically.

**Depends on:** E2-02, E5-01

**Touches:** `packages/pipeline/src/visuals.ts`, `apps/worker/src/visuals.ts`

**Interface:** `pickVisuals(script, words): Clip[]` — for each beat: search user library → stock → AI image (E5-03), in that order, scoring candidates by CLIP-style text–image similarity.

**Acceptance:**

- [ ] Every beat gets at least one clip; clip boundaries align to beat start/end word timings ±1 frame
- [ ] No clip shorter than 0.8 s; still images get Ken Burns motion
- [ ] Same asset is not used twice in one Short unless it is the user's own

**Test:** `pnpm -F pipeline test visuals`

**Out of scope:** generative video clips (credits, later sprint).

#### E5-03 AI image generation adapter

**Intent:** fill gaps stock cannot cover with original AI imagery the user owns.

**Depends on:** E0-02

**Touches:** `packages/providers/src/image/*`

**Interface:** `generateImage({ prompt, aspect: '9:16', style }): Asset` with `source: 'ai_generated'`, provider and model stored in `licence`.

**Acceptance:**

- [ ] Prompts are rejected if they name real people or trademarks (blocklist + LLM check)
- [ ] Generated assets record provider, model and prompt
- [ ] Adapter is swappable via env (`IMAGE_PROVIDER`)

**Test:** `pnpm -F providers test image`

**Out of scope:** image editing.

### E6 Render and captions

#### E6-01 Timeline assembler

**Intent:** turn script, voice and visuals into one valid `Timeline` the renderer can draw.

**Depends on:** E5-01, E5-02

**Touches:** `packages/pipeline/src/timeline.ts`

**Interface:** `assembleTimeline({ script, voice, clips, music?, captionStyle }): Timeline`

**Acceptance:**

- [ ] Output always validates against `Timeline`; duration = voice length + 300 ms tail
- [ ] Optional music from the in-app library is ducked 12 dB under speech
- [ ] Pure function: same input gives byte-identical output

**Test:** `pnpm -F pipeline test timeline`

**Out of scope:** transitions beyond hard cuts and crossfades.

#### E6-02 Animated caption presets

**Intent:** captions that look native to Shorts, readable on mute, inside platform safe areas.

**Depends on:** E0-05

**Touches:** `packages/render/src/captions/*`

**Build:** 6 Remotion presets (bold-pop, clean-subtitle, highlight-word, karaoke, boxed, minimal); 1–3 words per page; emphasis words in accent colour; keep text out of the bottom 20% and right 15% of frame.

**Acceptance:**

- [ ] Golden-frame test per preset
- [ ] No caption box intersects the safe-area mask in any frame of the fixtures

**Test:** `pnpm -F render test captions`

**Out of scope:** user-designed presets.

#### E6-03 Render job

**Intent:** a single job renders the final MP4 and its rights manifest.

**Depends on:** E6-01, E6-02, E2-03

**Touches:** `apps/worker/src/render.ts`

**Interface:** job `render` input `{ timelineId }`, output `{ videoAssetId, manifestKey, thumbnailKey }`

**Acceptance:**

- [ ] A 60 s Short renders in under 3 min p95 on staging
- [ ] Thumbnail is extracted from the hook frame
- [ ] Credits settle on success and refund on failure

**Test:** `pnpm -F worker test render` + `pnpm e2e short-happy-path`

**Out of scope:** 4K output.

### E7 Review editor

#### E7-01 Create-a-Short wizard

**Intent:** from topic to rendered preview in four screens, under 15 minutes for a first-time user.

**Depends on:** E4-01, E6-03

**Touches:** `apps/web/app/(app)/new/*`

**Build:** Topic/trend → angle choice (3 options) → script edit (beat list, inline edit, regenerate one beat) → voice + caption style → render with live job progress.

**Acceptance:**

- [ ] Playwright walks the full flow with fake providers in under 60 s
- [ ] Editing a beat re-renders only voice and visuals for that beat
- [ ] Cost estimate is shown before render and matches the charge ±5%

**Test:** `pnpm -F web e2e wizard`

**Out of scope:** multi-track timeline editing.

#### E7-02 Preview and fix screen

**Intent:** users can correct anything they dislike before publishing, keeping a human in the loop.

**Depends on:** E7-01

**Touches:** `apps/web/app/(app)/projects/[id]/review/*`

**Build:** 9:16 player, per-beat visual swap (show 6 alternatives), caption text fix, re-render button, rights manifest panel, "approve for publishing" action.

**Acceptance:**

- [ ] Swapping a visual and re-rendering updates the preview
- [ ] Approve is disabled while `assertPublishable` fails, with the reason shown

**Test:** `pnpm -F web e2e review`

**Out of scope:** comments and multi-user approval (E11-02).

### E8 Publishing

#### E8-01 Connect a YouTube channel

**Intent:** users link the channel they publish to, granting only the scopes we need.

**Depends on:** E1-01

**Touches:** `apps/web/app/(app)/channels/*`, `packages/providers/src/youtube/*`

**Build:** Google OAuth with `youtube.upload` and `youtube.readonly`; store encrypted refresh token per channel; show channel name and avatar; disconnect revokes the token.

**Acceptance:**

- [ ] Tokens are encrypted at rest (AES-GCM, key from KMS env)
- [ ] Expired token triggers a re-connect prompt, not a silent failure

**Test:** `pnpm -F providers test youtube-auth`

**Out of scope:** Brand Account switching UI.

#### E8-02 Publish and schedule to YouTube

**Intent:** one click puts an approved Short on the user's channel, correctly labelled.

**Depends on:** E8-01, E7-02

**Touches:** `apps/worker/src/publish.ts`, `packages/providers/src/youtube/upload.ts`

**Interface:** job `publish` input `PublishRequest`; resumable `videos.insert`; record `publish_records { platform, externalId, url, status, publishedAt }`.

**Build:**

1. Run `assertPublishable` and `checkVariation` first; refuse on failure.
2. Title ≤ 100 chars, `#Shorts` in description, attributions appended, altered/synthetic-content flag set when AI visuals or voice are realistic.
3. Scheduled posts upload as private with `publishAt`.
4. Track daily quota (100 uploads per project by default); queue overflow to next day and tell the user.

**Acceptance:**

- [ ] Happy path against a recorded API cassette creates a publish record with a URL
- [ ] Quota exhaustion results in `scheduled_next_window`, not failure
- [ ] Retry never double-uploads (idempotency key = renderId + channelId)

**Test:** `pnpm -F worker test publish-youtube`

**Out of scope:** playlists, end screens.

#### E8-03 TikTok Direct Post (Q2)

**Intent:** publish the same Short to TikTok within TikTok's developer rules.

**Depends on:** E8-02

**Touches:** `packages/providers/src/tiktok/*`, `apps/web/app/(app)/publish/tiktok/*`

**Build:** Login Kit + Content Posting API; call `creator_info` before rendering the post form; show preview, privacy options from the API, commercial-content toggles, AI-content label, and explicit consent; `pull_from_url` with a signed public R2 URL.

**Acceptance:**

- [ ] Form matches every item in TikTok's content-sharing guidelines checklist (stored in `docs/tiktok-audit.md`)
- [ ] While unaudited, UI states posts will be private
- [ ] No ShortLoop watermark is added to TikTok uploads

**Test:** `pnpm -F web e2e publish-tiktok`

**Out of scope:** photo posts.

#### E8-04 Instagram Reels publishing (Q2)

**Intent:** publish to Instagram Business/Creator accounts as Reels.

**Depends on:** E8-02

**Touches:** `packages/providers/src/instagram/*`

**Build:** Instagram Login, container create with `media_type=REELS`, poll status once a minute for at most 5 minutes, publish; check `content_publishing_limit` before each post.

**Acceptance:**

- [ ] Personal accounts get a clear "switch to Professional" message
- [ ] Rate-limit errors queue the post for the next window

**Test:** `pnpm -F providers test instagram`

**Out of scope:** Facebook Page reels.

### E9 MCP server

#### E9-01 MCP server v1

**Intent:** Claude, ChatGPT and Cursor users can make and publish Shorts by asking their agent.

**Depends on:** E7-01, E8-02

**Touches:** `apps/mcp/*`

**Interface (tools):** `get_trends`, `create_short` (topic → job), `get_job`, `wait_for_job` (≤ 50 s), `list_voices`, `list_caption_styles`, `estimate_cost`, `swap_visual`, `approve_short`, `publish_short`, `get_credit_balance`. Each tool's input/output is the Zod contract converted to JSON Schema.

**Build:** Streamable HTTP transport, OAuth 2.1 sharing the web app's accounts, every tool calls the same service functions the web app uses (no logic in the MCP layer).

**Acceptance:**

- [ ] MCP Inspector lists all tools with schemas and descriptions
- [ ] Scripted agent test: create → wait → approve → publish succeeds with fakes
- [ ] `publish_short` requires a prior `approve_short` in the same project

**Test:** `pnpm -F mcp test`

**Out of scope:** MCP resources and prompts.

#### E9-02 Format playbooks

**Intent:** new Short formats ship as text, not code, and agents follow them step by step.

**Depends on:** E9-01

**Touches:** `apps/mcp/playbooks/*.md`, `apps/mcp/src/playbooks.ts`

**Interface:** `list_workflows()`, `get_workflow(slug, phase)` returning markdown instructions.

**Build:** ship 4 playbooks: *trend explainer*, *myth vs fact*, *top-3 list*, *news-in-60s* (with sourcing rules: cite 2 sources in description).

**Acceptance:**

- [ ] Each playbook has phases `start`, `script`, `visuals`, `publish`
- [ ] Lint test fails a playbook that references a tool name that doesn't exist

**Test:** `pnpm -F mcp test playbooks`

**Out of scope:** user-uploaded playbooks.

### E13 Safety and compliance

#### E13-01 Content policy checks

**Intent:** block scripts and prompts that would get users struck or put us at legal risk.

**Depends on:** E4-01

**Touches:** `packages/pipeline/src/policy.ts`

**Interface:** `policyCheck(script | prompt): { allow: boolean, reasons[] }` covering: real-person impersonation, medical/financial advice without disclaimer, hate/harassment, minors, trademarked characters, copyrighted lyrics.

**Acceptance:**

- [ ] Red-team fixture set of 60 inputs: ≥ 95% correctly classified
- [ ] Blocked items show a user-readable reason

**Test:** `pnpm -F pipeline test policy`

**Out of scope:** video-frame moderation.

#### E13-02 Observability and audit log

**Intent:** we can explain any publish: who, what assets, which checks passed.

**Depends on:** E8-02

**Touches:** `packages/pipeline/src/audit.ts`, `infra/otel/*`

**Build:** OpenTelemetry traces across web → queue → worker; append-only `audit_events` for asset import, overrides, approvals, publishes; Sentry for errors.

**Acceptance:**

- [ ] A publish can be traced end to end by its job id
- [ ] Every override of a blocked check has an audit event with user id

**Test:** `pnpm -F pipeline test audit`

**Out of scope:** SOC 2 tooling.

#### E13-03 Music and audio rights check (Q2)

**Intent:** prevent uploaded audio that contains commercial music from reaching a publish.

**Depends on:** E2-01

**Touches:** `packages/providers/src/fingerprint/*`

**Interface:** `fingerprint(audioAsset): { matches: { title, owner, confidence }[] }` via an audio-recognition API.

**Acceptance:**

- [ ] A match above 0.8 confidence blocks publishing unless the asset source is `library_music`
- [ ] Fake provider covers match / no-match in tests

**Test:** `pnpm -F providers test fingerprint`

**Out of scope:** video fingerprinting.

### E3 Trend radar (Q2)

#### E3-01 Trend source collectors

**Intent:** know what is rising in each niche every morning without touching anyone's footage.

**Depends on:** E0-04

**Touches:** `apps/worker/src/trends/*`, `packages/providers/src/trends/*`

**Interface:** `collect(region, categoryIds[]): TrendSignal[] { source, title, url?, keywords[], metric, observedAt }`

**Build:** collectors for YouTube Data API `videos.list chart=mostPopular` (metadata only: titles, tags, view counts), Google Trends rising queries, Wikipedia pageview spikes, and RSS from niche news sites. Run hourly; store raw signals 30 days.

**Acceptance:**

- [ ] Collectors never download video or audio (test asserts no media URLs are fetched)
- [ ] YouTube collector uses ≤ 500 quota units/day per region

**Test:** `pnpm -F worker test trends-collect`

**Out of scope:** TikTok trend scraping (not permitted; revisit via official APIs).

#### E3-02 Topic clustering and velocity

**Intent:** turn noisy signals into a short list of topics with momentum.

**Depends on:** E3-01

**Touches:** `packages/pipeline/src/trends/cluster.ts`

**Interface:** `clusterTopics(signals, niche): Topic[] { id, label, keywords, velocity, sources[], firstSeen }`

**Build:** embed signal titles, HDBSCAN or agglomerative clustering, velocity = growth of signal count × metric over 24 h vs 7-day baseline; LLM labels each cluster in ≤ 6 words.

**Acceptance:**

- [ ] On the 7-day fixture set, known spikes rank in the top 5 for their niche
- [ ] Deterministic given a fixed seed

**Test:** `pnpm -F pipeline test trends-cluster`

**Out of scope:** cross-language clustering.

#### E3-03 Daily brief

**Intent:** each creator opens the app (or their inbox) to 3–5 ready-to-make angles for their niche.

**Depends on:** E3-02, E4-01

**Touches:** `apps/worker/src/brief.ts`, `apps/web/app/(app)/today/*`

**Interface:** `buildBrief(channelId, date): Brief { items: { topicId, angle, hook, format, whyNow, sources[] }[] }`

**Acceptance:**

- [ ] Brief excludes topics the channel covered in the last 14 days
- [ ] Each item has ≥ 1 linked source and a one-click "Make this Short"
- [ ] Email digest sent at the user's chosen local time

**Test:** `pnpm -F worker test brief` + `pnpm -F web e2e today`

**Out of scope:** push notifications.

#### E3-04 Fact grounding for news formats

**Intent:** trend-led scripts state facts that are sourced, protecting creators' credibility.

**Depends on:** E3-03

**Touches:** `packages/pipeline/src/grounding.ts`

**Interface:** `groundScript(script, sources[]): { script, citations: { beatId, url }[], unsupported: beatId[] }`

**Acceptance:**

- [ ] Beats with unsupported factual claims are flagged before render
- [ ] Citations are added to the publish description

**Test:** `pnpm -F pipeline test grounding`

**Out of scope:** live fact-check APIs.

### E10 Analytics and learning (Q3)

#### E10-01 Performance ingest

**Intent:** bring each published Short's results back so the product can learn.

**Depends on:** E8-02

**Touches:** `apps/worker/src/analytics/*`, `packages/providers/src/youtube/analytics.ts`

**Interface:** daily job storing `short_metrics { publishId, date, views, avgViewPct, likes, comments, subsGained, swipeAwayRate? }` from the YouTube Analytics API (and TikTok/IG insights where available).

**Acceptance:**

- [ ] Backfills 28 days on first connect; idempotent daily upserts
- [ ] Dashboard card shows views and retention per Short

**Test:** `pnpm -F worker test analytics`

**Out of scope:** revenue data.

#### E10-02 Feature store for Shorts

**Intent:** describe every Short by the choices we made so we can see which ones work.

**Depends on:** E10-01

**Touches:** `packages/pipeline/src/features.ts`

**Interface:** `featurize(shortId): { hookType, hookWords, durationS, beats, captionStyle, voiceId, visualMix, format, topicVelocity, postHour }`

**Acceptance:**

- [ ] Every published Short has a feature row
- [ ] Export to Parquet for offline analysis

**Test:** `pnpm -F pipeline test features`

**Out of scope:** model training.

#### E10-03 Per-channel recommender

**Intent:** the brief and script generator favour hooks, formats and lengths that retain this channel's audience.

**Depends on:** E10-02, E3-03

**Touches:** `packages/pipeline/src/recommend.ts`

**Interface:** `recommend(channelId): { preferredFormats[], hookPatterns[], targetSeconds, postHour }` via a Bayesian bandit over format × hook type, with a shared prior from all opted-in channels.

**Acceptance:**

- [ ] Offline replay on fixture data beats a uniform baseline on avg view %
- [ ] Users can see and override why a recommendation was made

**Test:** `pnpm -F pipeline test recommend`

**Out of scope:** auto-publishing without approval.

### E11 Agency (Q3)

#### E11-01 Workspaces, seats and roles

**Intent:** an agency manages many client channels with the right people seeing the right things.

**Depends on:** E1-01

**Touches:** `packages/db/*`, `apps/web/app/(app)/settings/team/*`

**Interface:** roles `owner`, `editor`, `reviewer`, `client`; every query scoped by `workspaceId`.

**Acceptance:**

- [ ] Authorization tests prove a user cannot read another workspace's projects
- [ ] Seat count is enforced by plan

**Test:** `pnpm -F web test authz`

**Out of scope:** SSO.

#### E11-02 Approval workflow

**Intent:** nothing publishes for a client until the right person approves.

**Depends on:** E11-01, E7-02

**Touches:** `apps/web/app/(app)/approvals/*`

**Build:** per-channel rule (none / one reviewer / client sign-off); comments on beats; approval link for clients without seats.

**Acceptance:**

- [ ] Publish is blocked until the channel's rule is satisfied
- [ ] Approval events land in the audit log

**Test:** `pnpm -F web e2e approvals`

**Out of scope:** Slack approvals.

#### E11-03 Brand kits and content calendar

**Intent:** each client's Shorts look consistent and are planned across the week.

**Depends on:** E11-01

**Touches:** `apps/web/app/(app)/brand/*`, `apps/web/app/(app)/calendar/*`

**Build:** brand kit (fonts, colours, logo bug, intro/outro card, caption preset, voice); calendar with drag-to-schedule across channels.

**Acceptance:**

- [ ] Applying a brand kit changes render output (golden test)
- [ ] Calendar respects each platform's daily limits

**Test:** `pnpm -F web e2e calendar` + `pnpm -F render test brand`

**Out of scope:** white-labelling.

### E12 Public platform (Q4)

#### E12-01 Public REST API

**Intent:** developers and agencies integrate Short creation into their own systems.

**Depends on:** E9-01

**Touches:** `apps/web/app/api/v1/*`, `docs/api/openapi.yaml`

**Build:** OpenAPI 3.1 generated from Zod; API keys per workspace; endpoints mirror MCP tools; webhooks `job.succeeded`, `job.failed`, `publish.completed` signed with HMAC.

**Acceptance:**

- [ ] Contract tests validate every response against the OpenAPI spec
- [ ] Rate limits per key; 429 with `Retry-After`

**Test:** `pnpm -F web test api-contract`

**Out of scope:** SDKs (E12-02).

#### E12-02 SDKs and MCP GA

**Intent:** make integration a five-minute job.

**Depends on:** E12-01

**Touches:** `packages/sdk-ts/*`, `packages/sdk-py/*`, `apps/mcp/*`

**Build:** generated TypeScript and Python SDKs; MCP server listed in public directories with docs and examples.

**Acceptance:**

- [ ] SDK quick-start creates and publishes a Short against staging in CI
- [ ] MCP directory listing passes each directory's validation

**Test:** `pnpm -F sdk-ts test` + `pytest packages/sdk-py`

**Out of scope:** other languages.

#### E12-03 Integrations

**Intent:** meet users where they already work.

**Depends on:** E12-01

**Touches:** `apps/integrations/*`

**Build:** Zapier/Make app (trigger: brief ready, Short rendered; action: create Short), Notion/Google Sheets content-calendar import.

**Acceptance:**

- [ ] Each integration passes its marketplace review checklist
- [ ] Import maps rows to projects with validation errors shown per row

**Test:** `pnpm -F integrations test`

**Out of scope:** native Slack app.

## Risks and sources

| Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| YouTube tightens inauthentic-content enforcement further | Medium | High | Variation guard (E4-02), channel voice (E4-03), human approval step, safety KPI | Product |
| TikTok or Instagram audit delays public posting | High | Medium | File in S0; YouTube-first launch; honest private-only UI | Founder |
| AI provider price or quality changes | Medium | Medium | Provider adapters (`packages/providers`), monthly cost review, cheapest-good default | Eng |
| Incumbents add trend briefs | Medium | High | Speed to the learning loop (O4); per-channel data moat; MCP distribution | Founder |
| Agent-written code quality drifts | Medium | Medium | Small tickets, contract-first, DoD gates, human review of every PR | Eng lead |
| Users upload media they don't own | Medium | High | Attestation, fingerprinting (E13-03), takedown process, audit log | Ops |

**Sources** (market and platform facts are carried over from the earlier research doc and were current as of mid-2026)

- [YouTube July 2026 monetisation clarifications — OutlierKit](https://outlierkit.com/blog/youtube-updates-july-2026)
- [YouTube inauthentic content policy — ytgrowth](https://ytgrowth.io/blog/youtube-ai-policy)
- [YouTube API quota buckets — bundle.social](https://bundle.social/blog/youtube-api-quota-exceeded-limits-fixes)
- [YouTube Data API videos guide — Google](https://developers.google.com/youtube/v3/guides/implementation/videos?hl=en)
- [TikTok content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
- [Instagram content publishing — Meta](https://developers.secure.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
- [OpusClip pricing — Creatify](https://creatify.ai/blog/opusclip-pricing-plans-and-what-you-ll-actually-pay-in-2026)
- [OpusClip alternatives — Castmagic](https://www.castmagic.io/de/blog/opus-clip-alternatives)
- [Everygen MCP review — AITuber](https://aituber.app/blog/everygen-mcp/)
- [VideoGen MCP](https://videogen.io/videogen-mcp)

Cost-per-Short and revenue targets are planning assumptions, not sourced figures; validate them in phase 0.
