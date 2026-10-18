# ADR 0005: Server actions + route handlers for the web app (tRPC deferred); interim email + password sign-in

Status: proposed (needs owner sign-off) · Date: 2026-10-18

## Context

The stack table says "Next.js route handlers + tRPC for the app". Batch D (E1-01, E2-01, E7-01, E7-02) is the first UI.
Next.js 16 server actions now give end-to-end typed calls from client components to server functions with no extra
router, client or adapter, and the app has one client (itself). The MCP server (E9-01) and the public REST API (E12-01)
must call the same service functions, which live in `apps/web/src/server/*` and are plain async TypeScript.

E1-01 names "email magic link and Google". Magic links need an email provider (and a sending domain); Google needs an
OAuth client. Neither exists yet, and we want staging usable today.

## Decision

1. The app calls `apps/web/src/server/*` through **server actions** (`app/(app)/actions.ts`) and a few **route handlers**
   (`/api/projects/[id]` for polling, `/api/uploads*` for signed uploads, `/api/files/*` for signed local files).
   No tRPC for now. Services take `userId` explicitly and never read the request, so MCP/REST can reuse them as-is.
2. Sign-in is **Better Auth email + password** now; **Google** switches on automatically when
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. **Magic link** is added when an email provider is chosen (a separate ticket).

## Consequences

- Less code and one fewer dependency; types flow from the service signatures.
- If we later want tRPC (e.g. a native app client), the service layer is already the boundary, so it's an additive change.
- Password sign-in means we store password hashes (Better Auth, scrypt). Rate limiting is on by default
  (`AUTH_RATE_LIMIT=off` only in e2e).
