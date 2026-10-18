import { getSession } from "../../../../src/server/auth";
import { completeUpload } from "../../../../src/server/library";
import { UserError } from "../../../../src/server/projects";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ assetId: await completeUpload(session.user.id, await req.json()) });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof Error && "issues" in e)
      return Response.json({ error: "Invalid upload." }, { status: 400 });
    throw e;
  }
}
