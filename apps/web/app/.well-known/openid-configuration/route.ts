import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { auth } from "../../../src/server/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return oauthProviderOpenIdConfigMetadata(await auth())(req);
}
