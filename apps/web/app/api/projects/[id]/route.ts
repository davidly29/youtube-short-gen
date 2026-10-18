import { auth } from "../../../../src/server/auth";
import { projectView, UserError } from "../../../../src/server/projects";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await (await auth()).api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return Response.json(await projectView(session.user.id, id));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
