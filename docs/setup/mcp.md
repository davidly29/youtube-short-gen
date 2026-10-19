# Using ShortLoop from AI assistants (MCP)

ShortLoop is an MCP server at **`https://<app>/api/mcp`** (staging: `https://web-staging-0f0b5.up.railway.app/api/mcp`),
Streamable HTTP, MCP spec 2026-07-28 (2025-era clients are served statelessly too).

**Sign-in:** OAuth 2.1 against the same ShortLoop accounts (Better Auth `@better-auth/mcp`). Clients discover it from
the `401` challenge → `/.well-known/oauth-protected-resource/api/mcp` → `/.well-known/oauth-authorization-server/api/auth`.
Clients identify with a Client ID Metadata Document (CIMD) or register dynamically. Users see a consent screen naming
the app; tokens are bound to the `/api/mcp` resource.

**Connect:** Claude (Settings → Connectors → Add custom connector), ChatGPT (developer mode connectors) or Cursor
(`mcp.json` with the URL). Paste the URL, sign in, Allow.

**Tools:** `create_short`, `get_job`, `wait_for_job` (≤ 50 s), `list_voices`, `list_caption_styles`, `estimate_cost`,
`swap_visual`, `approve_short`, `publish_short`, `get_credit_balance`, `get_trends` (says it's coming in Q2 until E3).
Every tool calls the same service functions as the web app; publishing requires `approve_short` first.

**Try it locally** with MCP Inspector: `npx @modelcontextprotocol/inspector`, URL `http://localhost:3000/api/mcp`.
