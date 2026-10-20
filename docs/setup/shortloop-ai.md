# ShortLoop AI (AI on our keys for paid plans)

ShortLoop AI is AI that runs on ShortLoop's own provider keys, for Creator and Pro subscribers and for
admins. Free and beta access-code users keep using their own keys or the free providers. The design and
the owner's decisions are in [ADR 0007](../adr/0007-provider-routing-and-shortloop-ai.md).

## 1. Create accounts and cap spend in each console (do this first)

| Provider                 | Used for                               | Where to set a hard limit                                                                                            |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Google AI Studio / Cloud | scripts (Gemini Flash), premium images | Cloud Billing → Budgets & alerts, plus a per-project quota cap. Billing must be on: the free tier has no image quota |
| fal.ai                   | standard images (Flux schnell)         | fal dashboard → Billing: use prepaid credits, with auto top-up off                                                   |
| ElevenLabs               | voices (Flash v2.5, commercial rights) | a paid plan with usage-based billing off, or a fixed credit pack                                                     |

Make the console caps slightly higher than `MANAGED_AI_DAILY_BUDGET_USD` × 31. They are the backstop if
ShortLoop's own guardrails ever fail.

## 2. Set the env vars on `web` (and `worker` if it runs separately)

| Variable                                    | Meaning                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MANAGED_AI_ENABLED`                        | `1` turns ShortLoop AI on. Unset or anything else switches it off for everyone (kill switch)                                    |
| `MANAGED_GEMINI_API_KEY`                    | Gemini key for scripts and premium images                                                                                       |
| `MANAGED_FAL_KEY`                           | fal key for standard images                                                                                                     |
| `MANAGED_ELEVENLABS_API_KEY`                | ElevenLabs key for voices                                                                                                       |
| `MANAGED_AI_DAILY_BUDGET_USD`               | platform-wide daily spend ceiling (default `25`); when reached, ShortLoop AI pauses until midnight UTC and Sentry gets an alert |
| `MANAGED_ADMIN_MONTHLY_USD`                 | per-admin monthly ceiling (default `50`)                                                                                        |
| `MANAGED_LLM_MODEL` / `MANAGED_IMAGE_MODEL` | optional model overrides (defaults in `DEFAULT_MODELS`)                                                                         |

Each job is only offered when its key is set. For example, with only `MANAGED_FAL_KEY` set, paid users get
ShortLoop images but still need their own key for scripts.

## 3. Check it

- **Admin page:** shows "ShortLoop AI on", today's spend against the daily budget, this month's spend, and
  the top users.
- **Settings → API keys:** a paid user sees "ShortLoop AI (in your plan)" as the default for each job, and
  how much of the month's allowance they've used (as a percentage, not dollars).

## Limits users hit (from `MANAGED_LIMITS`)

|                                   | Creator                             | Pro                 |
| --------------------------------- | ----------------------------------- | ------------------- |
| Per month                         | $7.25 (25% of $29)                  | $19.75 (25% of $79) |
| Shorts per day                    | 5                                   | 15                  |
| Per Short                         | $0.25, or $0.60 with premium images | same                |
| AI image swaps per Short          | 10                                  | same                |
| AI script generations per project | 4                                   | same                |

When a limit is hit, images and voices use the free providers, and the review screen says why. Scripts stop
with a message telling the user to add their own key or write the script themselves.
