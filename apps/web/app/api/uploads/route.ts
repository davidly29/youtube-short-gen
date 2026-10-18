import { getSession } from "../../../src/server/auth";
import { presignUpload } from "../../../src/server/library";
import { UserError } from "../../../src/server/projects";

export const dynamic = "force-dynamic";

/** POST { filename, contentType, size, attested } -> { key, url, contentType }. Attestation is checked here, not just in the UI. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json(await presignUpload(session.user.id, await req.json()));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof Error && "issues" in e)
      return Response.json({ error: "Invalid upload request." }, { status: 400 });
    throw e;
  }
}
