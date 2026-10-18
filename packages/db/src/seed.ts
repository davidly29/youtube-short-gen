import type { Db } from "./client";
import { assets, creditLedger, projects, users } from "./schema";

export const SEED = {
  userId: "usr_seed",
  projectId: "prj_seed",
  assetIds: ["ast_seed_1", "ast_seed_2", "ast_seed_3"],
} as const;

const stockLicence = (photographer: string) => ({
  type: "stock" as const,
  provider: "pexels",
  licenceUrl: "https://www.pexels.com/license/",
  attribution: `Photo by ${photographer} on Pexels`,
});

/** One user, one project, three stock assets and a signup grant. Safe to run repeatedly. */
export async function seed(db: Db): Promise<void> {
  await db
    .insert(users)
    .values({ id: SEED.userId, email: "seed@shortloop.local", name: "Seed User" })
    .onConflictDoNothing();
  await db
    .insert(projects)
    .values({ id: SEED.projectId, ownerId: SEED.userId, title: "Why octopuses have three hearts" })
    .onConflictDoNothing();
  await db
    .insert(assets)
    .values(
      SEED.assetIds.map((id, i) => ({
        id,
        ownerId: SEED.userId,
        kind: "image" as const,
        source: "stock" as const,
        licence: stockLicence(["A. Diver", "B. Reef", "C. Tide"][i] ?? "Unknown"),
        storageKey: `seed/${id}.jpg`,
        width: 1080,
        height: 1920,
      })),
    )
    .onConflictDoNothing();
  const existing = await db.query.creditLedger.findFirst({
    where: (l, { and, eq }) => and(eq(l.ownerId, SEED.userId), eq(l.reason, "signup")),
  });
  if (!existing) {
    await db.insert(creditLedger).values({ ownerId: SEED.userId, unit: "short", delta: 5, reason: "signup" });
  }
}
