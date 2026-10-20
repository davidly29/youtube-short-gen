"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../src/server/auth";
import { setChannelNiche } from "../../../src/server/brief";
import { UserError } from "../../../src/server/errors";

/** Save the niche a channel's daily brief covers (E3-03b). */
export async function setNicheAction(
  channelId: string,
  nicheId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    await setChannelNiche(user.id, channelId, nicheId);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  revalidatePath("/today");
  revalidatePath("/channels");
  return { ok: true };
}
