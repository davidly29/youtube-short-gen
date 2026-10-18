# Roadmap (dependency order)

Generated from [business-plan.md](business-plan.md). Agents take the first open `agent-ready` issue in the earliest milestone whose blockers are closed.
Later-quarter tickets are `agent-proposed` until the weekly planner sharpens them and the owner approves.

## S0

| Issue | Ticket | Title                                | Blocked by |
| ----- | ------ | ------------------------------------ | ---------- |
| #1    | E0-01  | Monorepo scaffold and CI             | none       |
| #2    | E0-02  | Core contracts                       | #1         |
| #3    | E0-03  | Database schema and migrations       | #2         |
| #4    | E0-04  | Job queue and worker skeleton        | #3         |
| #5    | E0-05  | Render smoke test in the cloud       | #4         |
| #45   | human  | File TikTok Content Posting audit    | owner      |
| #46   | human  | Google Cloud project + OAuth consent | owner      |
| #54   | human  | Hosting decision for staging/prod    | owner      |

## S1

| Issue | Ticket | Title                             | Blocked by |
| ----- | ------ | --------------------------------- | ---------- |
| #6    | E1-01  | Sign-in and workspace             | #3         |
| #7    | E1-02  | Credits service                   | #4         |
| #8    | E2-01  | Upload with ownership attestation | #3, #6     |
| #9    | E2-02  | Stock media provider adapter      | #2         |
| #10   | E2-03  | Rights manifest on export         | #8, #9     |
| #47   | human  | Media/IP lawyer review            | owner      |
| #48   | human  | Ten user interviews               | owner      |
| #49   | human  | Provider accounts and API keys    | owner      |

## S2

| Issue | Ticket | Title                       | Blocked by |
| ----- | ------ | --------------------------- | ---------- |
| #11   | E4-01  | Topic to original script    | #2, #4     |
| #12   | E4-02  | Script variation guard      | #11        |
| #13   | E5-01  | Voiceover with word timings | #11        |
| #14   | E5-02  | Beat-to-visual matcher      | #9, #13    |
| #15   | E5-03  | AI image generation adapter | #2         |

## S3

| Issue | Ticket | Title                       | Blocked by    |
| ----- | ------ | --------------------------- | ------------- |
| #16   | E6-01  | Timeline assembler          | #13, #14      |
| #17   | E6-02  | Animated caption presets    | #5            |
| #18   | E6-03  | Render job                  | #16, #17, #10 |
| #19   | E7-01  | Create-a-Short wizard       | #11, #18      |
| #20   | E7-02  | Preview and fix screen      | #19           |
| #50   | human  | Stripe account and products | owner         |

## S4

| Issue | Ticket | Title                           | Blocked by |
| ----- | ------ | ------------------------------- | ---------- |
| #21   | E1-03  | Stripe subscriptions            | #7         |
| #22   | E8-01  | Connect a YouTube channel       | #6         |
| #23   | E8-02  | Publish and schedule to YouTube | #22, #20   |
| #51   | human  | Register three house channels   | owner      |

## S5

| Issue | Ticket | Title                       | Blocked by |
| ----- | ------ | --------------------------- | ---------- |
| #24   | E9-01  | MCP server v1               | #19, #23   |
| #25   | E9-02  | Format playbooks            | #24        |
| #26   | E13-01 | Content policy checks       | #11        |
| #27   | E13-02 | Observability and audit log | #23        |
| #52   | human  | YouTube quota extension     | owner      |
| #53   | human  | Meta/Instagram app review   | owner      |

## S6–S7

| Issue | Ticket | Title                           | Blocked by |
| ----- | ------ | ------------------------------- | ---------- |
| #28   | E3-01  | Trend source collectors         | #4         |
| #29   | E3-02  | Topic clustering and velocity   | #28        |
| #30   | E3-03  | Daily brief                     | #29, #11   |
| #31   | E3-04  | Fact grounding for news formats | #30        |

## S8–S9

| Issue | Ticket | Title                           | Blocked by |
| ----- | ------ | ------------------------------- | ---------- |
| #32   | E8-03  | TikTok Direct Post (Q2)         | #23        |
| #33   | E8-04  | Instagram Reels publishing (Q2) | #23        |

## S10–S11

| Issue | Ticket | Title                             | Blocked by |
| ----- | ------ | --------------------------------- | ---------- |
| #34   | E4-03  | Channel voice profile (Q2)        | #11, #22   |
| #35   | E13-03 | Music and audio rights check (Q2) | #8         |

## S12–S14

| Issue | Ticket | Title                    | Blocked by |
| ----- | ------ | ------------------------ | ---------- |
| #36   | E10-01 | Performance ingest       | #23        |
| #37   | E10-02 | Feature store for Shorts | #36        |
| #38   | E10-03 | Per-channel recommender  | #37, #30   |

## S15–S17

| Issue | Ticket | Title                           | Blocked by |
| ----- | ------ | ------------------------------- | ---------- |
| #39   | E11-01 | Workspaces, seats and roles     | #6         |
| #40   | E11-02 | Approval workflow               | #39, #20   |
| #41   | E11-03 | Brand kits and content calendar | #39        |

## S18–S23

| Issue | Ticket | Title           | Blocked by |
| ----- | ------ | --------------- | ---------- |
| #42   | E12-01 | Public REST API | #24        |
| #43   | E12-02 | SDKs and MCP GA | #42        |
| #44   | E12-03 | Integrations    | #42        |
