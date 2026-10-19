import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";

/** An MCP client wired straight into a handler (no network), as a signed-in user. For tests. */
export async function connectInProcess(handler: McpHttpHandler, authInfo: AuthInfo): Promise<Client> {
  const client = new Client({ name: "shortloop-test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
  });
  await client.connect(transport);
  return client;
}

/** Parse a tool result's structured content (throws with the tool's message when it's an error). */
export function data<T = Record<string, unknown>>(result: unknown): T {
  const r = result as { isError?: boolean; structuredContent?: T; content?: { text?: string }[] };
  if (r.isError) throw new Error(r.content?.[0]?.text ?? "tool error");
  return r.structuredContent as T;
}
