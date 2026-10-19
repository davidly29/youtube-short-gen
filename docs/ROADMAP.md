# Roadmap (dependency order)

Generated from [business-plan.md](business-plan.md). Agents take the first open `agent-ready` issue in the earliest milestone whose blockers are closed.
Later-quarter tickets are `agent-proposed` until the weekly planner sharpens them and the owner approves.
Status is the GitHub issue state as of the last planner run (2026-10-18). Tickets split during implementation are listed under their parent's sprint.

## S0

| Issue | Ticket | Title                                | Blocked by | Status |
| ----- | ------ | ------------------------------------ | ---------- | ------ |
| #1    | E0-01  | Monorepo scaffold and CI             | none       | closed |
| #2    | E0-02  | Core contracts                       | #1         | closed |
| #3    | E0-03  | Database schema and migrations       | #2         | closed |
| #4    | E0-04  | Job queue and worker skeleton        | #3         | open   |
| #5    | E0-05  | Render smoke test in the cloud       | #4         | open   |
| #45   | human  | File TikTok Content Posting audit    | owner      | open   |
| #46   | human  | Google Cloud project + OAuth consent | owner      | open   |
| #54   | human  | Hosting decision for staging/prod    | owner      | open   |

## S1

| Issue | Ticket | Title                             | Blocked by | Status |
| ----- | ------ | --------------------------------- | ---------- | ------ |
| #6    | E1-01  | Sign-in and workspace             | #3         | open   |
| #7    | E1-02  | Credits service                   | #4         | open   |
| #8    | E2-01  | Upload with ownership attestation | #3, #6     | open   |
| #9    | E2-02  | Stock media provider adapter      | #2         | open   |
| #10   | E2-03  | Rights manifest on export         | #8, #9     | open   |
| #47   | human  | Media/IP lawyer review            | owner      | open   |
| #48   | human  | Ten user interviews               | owner      | open   |
| #49   | human  | Provider accounts and API keys    | owner      | open   |

## S2

| Issue | Ticket | Title                                                                | Blocked by | Status |
| ----- | ------ | -------------------------------------------------------------------- | ---------- | ------ |
| #11   | E4-01  | Topic to original script                                             | #2, #4     | open   |
| #12   | E4-02  | Script variation guard                                               | #11        | open   |
| #13   | E5-01  | Voiceover with word timings                                          | #11        | open   |
| #14   | E5-02  | Beat-to-visual matcher                                               | #9, #13    | open   |
| #15   | E5-03  | AI image generation adapter                                          | #2         | open   |
| #61   | E4-01b | Record real-LLM cassettes for script generation (split from #11)     | #11, #49   | open   |
| #62   | E5-01b | Forced-alignment fallback and timing accuracy check (split from #13) | #13        | open   |

## S3

| Issue | Ticket | Title                       | Blocked by    | Status |
| ----- | ------ | --------------------------- | ------------- | ------ |
| #16   | E6-01  | Timeline assembler          | #13, #14      | open   |
| #17   | E6-02  | Animated caption presets    | #5            | open   |
| #18   | E6-03  | Render job                  | #16, #17, #10 | open   |
| #19   | E7-01  | Create-a-Short wizard       | #11, #18      | open   |
| #20   | E7-02  | Preview and fix screen      | #19           | open   |
| #50   | human  | Stripe account and products | owner         | open   |

## S4

| Issue | Ticket | Title                           | Blocked by | Status |
| ----- | ------ | ------------------------------- | ---------- | ------ |
| #21   | E1-03  | Stripe subscriptions            | #7         | open   |
| #22   | E8-01  | Connect a YouTube channel       | #6         | open   |
| #23   | E8-02  | Publish and schedule to YouTube | #22, #20   | open   |
| #51   | human  | Register three house channels   | owner      | open   |

## S5

| Issue | Ticket | Title                       | Blocked by | Status          |
| ----- | ------ | --------------------------- | ---------- | --------------- |
| #24   | E9-01  | MCP server v1               | #19, #23   | open            |
| #25   | E9-02  | Format playbooks            | #24        | in review (#81) |
| #26   | E13-01 | Content policy checks       | #11        | open            |
| #27   | E13-02 | Observability and audit log | #23        | open            |
| #52   | human  | YouTube quota extension     | owner      | open            |
| #53   | human  | Meta/Instagram app review   | owner      | open            |

## S6–S7

| Issue | Ticket | Title                           | Blocked by | Status |
| ----- | ------ | ------------------------------- | ---------- | ------ |
| #28   | E3-01  | Trend source collectors         | #4         | open   |
| #29   | E3-02  | Topic clustering and velocity   | #28        | open   |
| #30   | E3-03  | Daily brief                     | #29, #11   | open   |
| #31   | E3-04  | Fact grounding for news formats | #30        | open   |

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
