import { NextResponse } from "next/server";
import { getSession } from "../../../../src/server/auth";
import { seedFakeBrief } from "../../../../src/server/brief";

export const dynamic = "force-dynamic";

/**
 * Fake mode only (SHORTLOOP_FAKE_PROVIDERS=1): stores today's brief for the signed-in user's channel,
 * standing in for the 05:00 UTC job in e2e tests and demos. 404 everywhere else.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });
  try {
    const id = await seedFakeBrief(session.user.id);
    return NextResponse.json({ id });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
