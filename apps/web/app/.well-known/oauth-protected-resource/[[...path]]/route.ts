import { auth } from "../../../../src/server/auth";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected-resource metadata. The MCP plugin answers it from Better Auth's request hook, which matches
 * the original path (/.well-known/oauth-protected-resource[/api/mcp]), so the request is passed through as-is.
 */
export async function GET(req: Request) {
  return (await auth()).handler(req);
}
