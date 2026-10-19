"use client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/** `oauthProviderClient` carries an in-progress OAuth authorization (e.g. an MCP client sign-in) through sign-in. */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

/** After sign-in during an OAuth authorization, the server answers with where to continue. */
export function oauthContinueUrl(data: unknown): string | undefined {
  const d = data as { url?: unknown; redirect?: unknown; redirect_uri?: unknown } | null;
  const url = d?.url ?? d?.redirect_uri;
  return typeof url === "string" && url ? url : undefined;
}
