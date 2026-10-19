# Roadmap (dependency order)

Generated from [business-plan.md](business-plan.md). Agents take the first open `agent-ready` issue in the earliest milestone whose blockers are closed.
Later-quarter tickets are `agent-proposed` until the planner sharpens them (the builder may take them once the agent-ready tickets run out).
Status mirrors the GitHub issue (done = closed by a merged PR). The builder updates the rows it delivers in each PR and the daily planner
re-syncs everything. Last full sync: 2026-10-19. Tickets split during implementation are listed under their parent's sprint.

## S0

| Issue | Ticket | Title                                | Blocked by | Status |
| ----- | ------ | ------------------------------------ | ---------- | ------ |
| #1    | E0-01  | Monorepo scaffold and CI             | none       | done   |
| #2    | E0-02  | Core contracts                       | #1         | done   |
| #3    | E0-03  | Database schema and migrations       | #2         | done   |
| #4    | E0-04  | Job queue and worker skeleton        | #3         | done   |
| #5    | E0-05  | Render smoke test in the cloud       | #4         | done   |
| #45   | human  | File TikTok Content Posting audit    | owner      | open   |
| #46   | human  | Google Cloud project + OAuth consent | owner      | open   |
| #54   | human  | Hosting decision for staging/prod    | owner      | open   |

## S1

| Issue | Ticket | Title                             | Blocked by | Status |
| ----- | ------ | --------------------------------- | ---------- | ------ |
| #6    | E1-01  | Sign-in and workspace             | #3         | done   |
| #7    | E1-02  | Credits service                   | #4         | done   |
| #8    | E2-01  | Upload with ownership attestation | #3, #6     | done   |
| #9    | E2-02  | Stock media provider adapter      | #2         | done   |
| #10   | E2-03  | Rights manifest on export         | #8, #9     | done   |
| #47   | human  | Media/IP lawyer review            | owner      | open   |
| #48   | human  | Ten user interviews               | owner      | open   |
| #49   | human  | Provider accounts and API keys    | owner      | open   |

## S2

| Issue | Ticket | Title                                                                | Blocked by | Status |
| ----- | ------ | -------------------------------------------------------------------- | ---------- | ------ |
| #11   | E4-01  | Topic to original script                                             | #2, #4     | done   |
| #12   | E4-02  | Script variation guard                                               | #11        | done   |
| #13   | E5-01  | Voiceover with word timings                                          | #11        | done   |
| #14   | E5-02  | Beat-to-visual matcher                                               | #9, #13    | done   |
| #15   | E5-03  | AI image generation adapter                                          | #2         | done   |
| #61   | E4-01b | Record real-LLM cassettes for script generation (split from #11)     | #11, #49   | open   |
| #62   | E5-01b | Forced-alignment fallback and timing accuracy check (split from #13) | #13        | open   |

## S3

| Issue | Ticket | Title                       | Blocked by    | Status |
| ----- | ------ | --------------------------- | ------------- | ------ |
| #16   | E6-01  | Timeline assembler          | #13, #14      | done   |
| #17   | E6-02  | Animated caption presets    | #5            | done   |
| #18   | E6-03  | Render job                  | #16, #17, #10 | done   |
| #19   | E7-01  | Create-a-Short wizard       | #11, #18      | done   |
| #20   | E7-02  | Preview and fix screen      | #19           | done   |
| #50   | human  | Stripe account and products | owner         | open   |

## S4

| Issue | Ticket | Title                           | Blocked by | Status |
| ----- | ------ | ------------------------------- | ---------- | ------ |
| #21   | E1-03  | Stripe subscriptions            | #7         | done   |
| #22   | E8-01  | Connect a YouTube channel       | #6         | done   |
| #23   | E8-02  | Publish and schedule to YouTube | #22, #20   | done   |
| #51   | human  | Register three house channels   | owner      | open   |

## S5

| Issue | Ticket | Title                       | Blocked by | Status          |
| ----- | ------ | --------------------------- | ---------- | --------------- |
| #24   | E9-01  | MCP server v1               | #19, #23   | done            |
| #25   | E9-02  | Format playbooks            | #24        | in review (#81) |
| #26   | E13-01 | Content policy checks       | #11        | done            |
| #27   | E13-02 | Observability and audit log | #23        | in review (#82) |
| #52   | human  | YouTube quota extension     | owner      | open            |
| #53   | human  | Meta/Instagram app review   | owner      | open            |

## S6–S7

| Issue | Ticket | Title                                                     | Blocked by | Status          |
| ----- | ------ | --------------------------------------------------------- | ---------- | --------------- |
| #28   | E3-01  | Trend source collectors                                   | #4         | in review (#84) |
| #29   | E3-02  | Topic clustering and velocity                             | #28        | open            |
| #30   | E3-03  | Daily brief                                               | #29, #11   | open            |
| #31   | E3-04  | Fact grounding for news formats                           | #30        | open            |
| #75   | E3-01c | RSS collector with niche feed config (split from #28)     | #28        | in review (#84) |
| #76   | E3-01d | Google Trends signals (split from #28, owner decision)    | #28        | open            |
| #78   | E3-03b | Today page and niche picker (split from #30)              | #30        | open            |
| #79   | E3-03c | Daily brief email digest (split from #30, owner decision) | #30, #78   | open            |
| #83   | E3-01e | Run trend collection in the all-in-one web runtime        | #28        | open            |

## S8–S9

| Issue | Ticket | Title                           | Blocked by | Status |
| ----- | ------ | ------------------------------- | ---------- | ------ |
| #32   | E8-03  | TikTok Direct Post (Q2)         | #23        | open   |
| #33   | E8-04  | Instagram Reels publishing (Q2) | #23        | open   |

## S10–S11

| Issue | Ticket | Title                             | Blocked by | Status |
| ----- | ------ | --------------------------------- | ---------- | ------ |
| #34   | E4-03  | Channel voice profile (Q2)        | #11, #22   | open   |
| #35   | E13-03 | Music and audio rights check (Q2) | #8         | open   |

## S12–S14

| Issue | Ticket | Title                    | Blocked by | Status |
| ----- | ------ | ------------------------ | ---------- | ------ |
| #36   | E10-01 | Performance ingest       | #23        | open   |
| #37   | E10-02 | Feature store for Shorts | #36        | open   |
| #38   | E10-03 | Per-channel recommender  | #37, #30   | open   |

## S15–S17

| Issue | Ticket | Title                           | Blocked by | Status |
| ----- | ------ | ------------------------------- | ---------- | ------ |
| #39   | E11-01 | Workspaces, seats and roles     | #6         | open   |
| #40   | E11-02 | Approval workflow               | #39, #20   | open   |
| #41   | E11-03 | Brand kits and content calendar | #39        | open   |

## S18–S23

| Issue | Ticket | Title           | Blocked by | Status |
| ----- | ------ | --------------- | ---------- | ------ |
| #42   | E12-01 | Public REST API | #24        | open   |
| #43   | E12-02 | SDKs and MCP GA | #42        | open   |
| #44   | E12-03 | Integrations    | #42        | open   |

## Beyond the original plan

Work the owner asked for after the business plan was written. These are product decisions, so the builder must respect
them (see the ADRs).

| Where | What                                                                                                                                                                  | Status                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| #68   | **Bring your own keys** (ADR 0006): users add their own Gemini / Claude / OpenAI / ElevenLabs / Pexels / Pixabay / fal keys; the platform pays only for free defaults | done                  |
| #73   | **Admin + beta access codes**: `ADMIN_EMAILS` admins and `SHORTLOOP_ACCESS_CODES` beta testers get unlimited Shorts (still own keys); Admin page                      | done                  |
| #70   | E1-04 Enforce plan limits (channels per plan)                                                                                                                         | open (agent-proposed) |

Owner decisions recorded so far: PGlite in tests; Railway hosting; FFmpeg renderer (ADR 0004); server actions instead of
tRPC (ADR 0005); own-key Shorts still use credits; free Edge voices OK as default; Creator + Pro only, no credit rollover;
multi-ticket PRs welcome.
