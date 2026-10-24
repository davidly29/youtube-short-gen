# Listing ShortLoop in public MCP directories (E12-02)

Everything a directory needs comes from `src/listing.ts`. `pnpm -F mcp test listing` runs each directory's checks
against the real tool list, so a broken listing fails CI before anyone submits it. Regenerate the files with
`pnpm -F mcp build:listing` (set `SHORTLOOP_PUBLIC_URL` to list an origin other than staging).

| Directory                                                  | What we give it                       | Checked by              |
| ---------------------------------------------------------- | ------------------------------------- | ----------------------- |
| [MCP Registry](https://registry.modelcontextprotocol.io)   | `listing/server.json` (remote only)   | `checkOfficialRegistry` |
| PulseMCP, Glama and other registry mirrors                 | nothing: they import the MCP Registry | (same)                  |
| [Claude connectors directory](https://claude.ai/directory) | remote URL, OAuth, docs, legal links  | `checkClaudeDirectory`  |
| Cursor (docs and directory pages)                          | the install deeplink below            | `checkCursor`           |

## Before submitting (owner)

The automated checks pass. These need a decision or a page only the owner can provide:

1. **Production domain.** The files list staging (`https://web-staging-0f0b5.up.railway.app/api/mcp`). Rebuild with
   `SHORTLOOP_PUBLIC_URL=https://<production>` once it exists.
2. **privacy policy URL** — a public page describing what the connector stores (required by the Claude directory).
3. **support contact (email or URL)** — where directory reviewers and users report problems.
4. A **test account** for reviewers (Claude directory asks for one; an access code from `SHORTLOOP_ACCESS_CODES` works).

Then add `privacyPolicyUrl` and `supportContact` in `shortLoopListing()` and run the tests again.

## Submitting

- **MCP Registry:** install `mcp-publisher`, then from `apps/mcp/listing`: `mcp-publisher login github` (as
  `davidly29`, which proves the `io.github.davidly29/` namespace) and `mcp-publisher publish`.
- **Claude connectors directory:** fill in Anthropic's remote MCP server submission form with the remote URL, the docs
  link (`docs/setup/mcp.md`), the privacy policy, the support contact and the test account.
- **Cursor:** put this link behind an "Add to Cursor" button in the docs:

  `cursor://anysphere.cursor-deeplink/mcp/install?name=shortloop&config=eyJ1cmwiOiJodHRwczovL3dlYi1zdGFnaW5nLTBmMGI1LnVwLnJhaWx3YXkuYXBwL2FwaS9tY3AifQ%3D%3D`
