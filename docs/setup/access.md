# Admins and beta access codes

Both are configured with environment variables on the `web` service (never in the repo).

| Variable                 | Example                                 | Effect                                                                                                                                                                                                |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_EMAILS`           | `you@example.com,cofounder@example.com` | These accounts are **admins**: unlimited Shorts, and an **Admin** page (users, code usage). Synced at sign-up and at every sign-in, so removing an email demotes that account next time they sign in. |
| `SHORTLOOP_ACCESS_CODES` | `BETA2026:20,FRIENDS:5`                 | Beta codes, `CODE:maxUses` (default 25 uses). The first _maxUses_ people who enter a code (at sign-up, or on the Billing page) get unlimited Shorts. Matching ignores case and spaces.                |

Unlimited means no credits are reserved or charged. Everyone, admins included, still uses **their own AI keys** (Settings → API keys).
Redemptions and admin changes are written to the audit log. To end a beta, remove the code: existing holders keep access
(it's stored on their account); clear `users.access_code` and `credit_exempt` to revoke someone.
