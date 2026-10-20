# ADR 0007: Per-job provider routing, free fallbacks, and ShortLoop AI on paid plans

Status: accepted (owner, 2026-10-19) · Date: 2026-10-19 · Amends [ADR 0006](0006-bring-your-own-keys.md) points 3 and 5

## Context

A free-tier Gemini key fails every image with `429 … limit: 0`, because Google gives free keys no image quota.
Under ADR 0006, one Gemini key did scripts and images, so that error failed the whole Short. Separately,
most creators don't have AI keys at all, which undercuts the product for paying users.

We looked at how BYOK products handle this:

- **Cursor** routes only some features through the user's key; the rest always run on its own infrastructure.
- **Raycast** marks which models use the user's key, and only saves a key that passes a check.
- **OpenRouter** tries the user's key first, falls back to shared capacity, and lets each key opt out of that.
- **OpusClip, InVideo and Revid** use no user keys at all: credits per video, with the AI cost built in.

## Decision

**Routing**

1. In Settings → API keys, users pick a provider for each job: Script, Images, Voice. "Automatic" keeps the
   default for that job:
   - Scripts: the newest key that can write scripts.
   - Images: fal if a fal key is saved, otherwise ShortLoop AI on paid plans, otherwise free.
   - Voices: ElevenLabs if a key is saved, otherwise ShortLoop AI, otherwise free.

   A Gemini key does images only when the user picks it for images. `resolveRouting` in `@shortloop/contracts`
   is the one rule, shared by the worker, the web app and the Settings page.

**Errors and fallback**

2. Provider errors are classified as `auth`, `quota`, `rate_limit`, `unavailable`, `blocked` or `other`, each
   with a message that says what to do.
   - Rate limits and outages are retried up to 3 attempts, honouring the provider's retry delay.
   - `auth`, `quota` and `blocked` are permanent: the job fails on its first attempt instead of using up its
     retries.
3. When the provider for images or voices fails, the free provider (Pollinations, Edge) takes over, and the
   review screen says so.
   - After a permanent failure, the rest of that job skips the failing provider.
   - Scripts have no free fallback, so a script error fails the job with its message.
   - One beat's image failing everywhere doesn't fail the Short: the previous image stays on screen longer.
4. Key health is learned from use, which costs the user nothing. Every key records when it last worked and its
   last error. A `limit: 0` refusal marks the key unavailable for that job, and routing skips it until the user
   presses "Try again" (or re-saves the key).

**ShortLoop AI** (AI on our own keys)

5. Active **Creator and Pro** subscribers get ShortLoop AI: Gemini Flash scripts, fal Flux schnell images and
   ElevenLabs Flash voices, about $0.10 per Short. **Admins** get it too, metered. Free accounts and beta
   access-code holders don't. "Premium images" (Gemini) spend one AI-video credit per Short, charged only
   when a premium image is actually made (not when stock covers every beat). With no credit left, the Short
   uses standard images. The credit is refunded if the production fails. ShortLoop AI is only offered for jobs
   whose platform key is configured.
6. Guardrails. Each one is checked before every call, from the append-only `ai_usage` ledger:

   | Guardrail                      | Limit                                                                                             |
   | ------------------------------ | ------------------------------------------------------------------------------------------------- |
   | Kill switch                    | `MANAGED_AI_ENABLED=1` must be set; off by default                                                |
   | Platform daily budget          | `MANAGED_AI_DAILY_BUDGET_USD`, default $25; a Sentry alert fires when it's hit                    |
   | Per user per month             | 25% of the plan price: Creator $7.25, Pro $19.75; admins `MANAGED_ADMIN_MONTHLY_USD`, default $50 |
   | Per Short                      | $0.25, or $0.60 with premium images                                                               |
   | Shorts per day                 | Creator 5, Pro 15                                                                                 |
   | AI image swaps per Short       | 10                                                                                                |
   | Script generations per project | 4                                                                                                 |

   When a guardrail is hit, images and voices use the free providers with a notice. Scripts stop with a
   message pointing to own keys.

7. Costs are estimates from list prices (`MANAGED_PRICES`), rounded up. Token counts are estimated from text
   length. The Admin page shows spend today, this month, and the top spenders.

## Consequences

- Paying users can make Shorts without any AI accounts. At full use, AI costs about 12–16% of plan revenue
  on the cheap set, and at most 25% even if every Short hits its cap.
- The operator must create provider accounts (#49) with **hard spending caps in each console** (Google Cloud,
  fal, ElevenLabs), then set the `MANAGED_*` env vars. See `docs/setup/shortloop-ai.md`.
- Gemini 3.8 Flash doubles in price on 1 Jan 2027. Update `MANAGED_PRICES` when vendors change prices.
- Guardrail checks read the ledger and then make the call, so jobs running at the same time can each pass a
  check before any of them is recorded. Caps can overshoot by about one call per concurrent job. That's
  accepted for now; the console caps are the backstop. A per-owner lock can be added if bursts become common.
- Failures on ShortLoop's own keys are shown to users as "ShortLoop AI isn't available right now" (and alert
  Sentry). They are never shown as a problem with the user's billing, and they don't permanently fail the job.
- A prompt a provider refuses for safety is never retried on the free provider; that beat goes without an AI
  image.
- Edge voices are flagged non-commercial. When a ShortLoop or ElevenLabs voice falls back to Edge, the
  voice asset's licence records `edge`, so the rights manifest and AI disclosure stay truthful.
