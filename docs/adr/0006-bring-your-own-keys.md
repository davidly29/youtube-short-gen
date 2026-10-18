# ADR 0006: Users bring their own AI keys (BYOK); the platform pays only for free defaults

Status: accepted by owner request (2026-10-18), details proposed · Date: 2026-10-18

## Context

Paid AI calls (LLM scripts, premium voices, AI images, stock search quotas) would otherwise be billed to the
operator for every user. The owner wants creators to use, and pay for, their own provider accounts.

## Decision

1. Each user can save API keys for Anthropic, OpenAI, Google Gemini, ElevenLabs, fal.ai, Pexels and Pixabay in
   **Settings → API keys**. A key is checked with a free read-only call before it's saved (fal has none, so it's
   saved as "not checked").
2. Keys are stored **encrypted** (AES-256-GCM, master key `SHORTLOOP_SECRETS_KEY`, associated data binds each
   ciphertext to its owner and provider). Only the last four characters are ever shown again. Saves and removals
   write audit events (provider and last four only).
3. Every job resolves providers **for its owner**: the user's keys first, then platform defaults. When a user has
   several keys for one job (e.g. Claude and Gemini for scripts), the most recently saved wins.
4. Platform defaults are **free providers only** (Edge voices, Pollinations images). The operator's own env keys
   are shared with all users only when `SHORTLOOP_SHARED_KEYS=1` (e.g. a private beta).
5. Gemini is supported for scripts and images with one key. Model names are editable per user because providers
   rename models often; defaults live in `@shortloop/contracts` (`DEFAULT_MODELS`).

## Consequences

- No AI cost for the operator by default; the cost model in the business plan changes (see open question).
- Without any key, users can still hand-write scripts and get free voices and AI images.
- Rotating `SHORTLOOP_SECRETS_KEY` makes saved keys unreadable; they're then treated as missing and users re-enter
  them. A re-encryption script can be added if rotation is ever needed.

## Open question (owner)

Should Shorts made entirely with a user's own keys still consume ShortLoop credits (we still pay render compute and
storage), and should pricing tiers change to a lower "platform fee" model?
