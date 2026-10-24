# Using ShortLoop from AI assistants (MCP)

ShortLoop is an MCP server at **`https://<app>/api/mcp`** (staging: `https://web-staging-0f0b5.up.railway.app/api/mcp`),
Streamable HTTP, MCP spec 2026-07-28 (2025-era clients are served statelessly too).

**Sign-in:** OAuth 2.1 against the same ShortLoop accounts (Better Auth `@better-auth/mcp`). Clients discover it from
the `401` challenge → `/.well-known/oauth-protected-resource/api/mcp` → `/.well-known/oauth-authorization-server/api/auth`.
Clients identify with a Client ID Metadata Document (CIMD) or register dynamically. Users see a consent screen naming
the app; tokens are bound to the `/api/mcp` resource.

**Connect** (the same URL everywhere; sign in with your ShortLoop account when the client opens the browser):

| Client                        | How                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Claude (web, desktop, mobile) | Settings → Connectors → Add custom connector → URL `https://<app>/api/mcp` → Connect → Allow  |
| Claude Code                   | `claude mcp add --transport http shortloop https://<app>/api/mcp`, then `/mcp` to sign in     |
| ChatGPT                       | Developer mode connectors: add the URL above with OAuth                                       |
| Cursor                        | `~/.cursor/mcp.json`: `{"mcpServers":{"shortloop":{"url":"https://<app>/api/mcp"}}}`          |
| VS Code                       | `.vscode/mcp.json`: `{"servers":{"shortloop":{"type":"http","url":"https://<app>/api/mcp"}}}` |

**Tools** (20). Every tool calls the same service functions as the web app; publishing requires `approve_short` first.

| Step              | Tools                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account           | `get_account` (plan, credits, channels, what to set up next), `get_credit_balance`, `estimate_cost`                                                                            |
| Ideas             | `get_trends` (today's brief per channel, with `topic_id`), `get_recommendations` (formats, hooks, length, post hour that work for a channel), `list_workflows`, `get_workflow` |
| Make              | `create_short` (topic or a trend idea; `wait_seconds` ≤ 50 to wait in the same call), `get_job`, `wait_for_job` (≤ 50 s), `list_voices`, `list_caption_styles`                 |
| Review and fix    | `get_short` (script, video/thumbnail links, caption words, visual sources, publishable, `app_url`), `list_shorts`, `swap_visual`, `update_captions`                            |
| Publish and learn | `approve_short`, `publish_short`, `get_performance` (views, avg % viewed)                                                                                                      |
| Help              | `get_guide` (step-by-step), prompt `make_a_short`                                                                                                                              |

Read-only tools carry `readOnlyHint`, so clients can run them without asking each time.

**Try it locally** with MCP Inspector: `npx @modelcontextprotocol/inspector`, URL `http://localhost:3000/api/mcp`.
