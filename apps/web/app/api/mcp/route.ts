import { requireMcpAuth } from "@better-auth/mcp";
import { createShortLoopMcpHandler } from "@shortloop/mcp";
import { auth, mcpResource } from "../../../src/server/auth";
import { mcpServicesFor } from "../../../src/server/mcp-services";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // wait_for_job holds a request for up to 50 s

const handler = createShortLoopMcpHandler(
  (authInfo) => mcpServicesFor(String((authInfo.extra as { userId?: unknown } | undefined)?.userId ?? "")),
  { onError: (e) => console.error("[mcp]", e) },
);

/**
 * MCP endpoint (Streamable HTTP). Requests need an OAuth 2.1 access token issued by this app's auth server and
 * bound to this resource; without one the response is 401 with an RFC 9728 challenge so the client can sign in.
 */
export async function POST(req: Request) {
  const a = await auth();
  return requireMcpAuth(
    a,
    (request, claims) => {
      if (!claims.sub) return new Response("Token has no subject", { status: 401 });
      return handler.fetch(request, {
        authInfo: {
          token: "",
          clientId: String(claims.azp ?? claims.client_id ?? ""),
          scopes: String(claims.scope ?? "")
            .split(" ")
            .filter(Boolean),
          expiresAt: claims.exp,
          extra: { userId: claims.sub },
        },
      });
    },
    { resource: mcpResource() },
  )(req);
}

export async function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
