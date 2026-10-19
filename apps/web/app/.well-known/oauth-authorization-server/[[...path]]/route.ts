import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "../../../../src/server/auth";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization-server metadata (path-inserted issuer form: /.well-known/oauth-authorization-server/api/auth). */
export async function GET(req: Request) {
  return oauthProviderAuthServerMetadata(await auth())(req);
}
