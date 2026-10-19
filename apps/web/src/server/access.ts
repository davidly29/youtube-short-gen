import "server-only";
import { eq, schema, sql } from "@shortloop/db";
import { matchAccessCode, parseAccessCodes, parseAdminEmails } from "../lib/access-codes";
import { UserError } from "./errors";
import { runtime } from "./runtime";

export const isAdminEmail = (email: string) =>
  parseAdminEmails(process.env.ADMIN_EMAILS).has(email.trim().toLowerCase());

/**
 * Keep a user's role in step with ADMIN_EMAILS (called at sign-up and every sign-in). Admins are credit-exempt;
 * someone removed from the list goes back to a normal user unless they redeemed an access code.
 */
export async function syncAdmin(userId: string, email: string) {
  const { db } = await runtime();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) return;
  const admin = isAdminEmail(email);
  const role = admin ? "admin" : "user";
  const creditExempt = admin || Boolean(u.accessCode);
  if (u.role === role && u.creditExempt === creditExempt) return;
  await db.update(schema.users).set({ role, creditExempt }).where(eq(schema.users.id, userId));
  await db.insert(schema.auditEvents).values({
    ownerId: userId,
    type: admin ? "admin.granted" : "admin.revoked",
    subjectId: userId,
    data: {},
  });
}

export async function isAdmin(userId: string) {
  const { db } = await runtime();
  return (
    (await db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { role: true } }))
      ?.role === "admin"
  );
}

/** Redeem a beta access code: unlimited Shorts while it's valid. The first N people per code (SHORTLOOP_ACCESS_CODES). */
export async function redeemAccessCode(userId: string, input: unknown) {
  const raw = typeof input === "string" ? input : "";
  if (!raw.trim()) throw new UserError("Enter an access code.");
  const code = matchAccessCode(raw, parseAccessCodes(process.env.SHORTLOOP_ACCESS_CODES));
  if (!code) throw new UserError("That access code isn't valid.");
  const { db } = await runtime();
  return (db as unknown as { transaction: <T>(f: (tx: typeof db) => Promise<T>) => Promise<T> }).transaction(
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access_code:${code.code}`}))`);
      const me = await tx.query.users.findFirst({ where: eq(schema.users.id, userId) });
      if (!me) throw new UserError("Sign in first.");
      if (me.accessCode === code.code) return { alreadyRedeemed: true };
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(eq(schema.users.accessCode, code.code));
      if ((used?.n ?? 0) >= code.maxUses) throw new UserError("That access code has been fully used.");
      await tx
        .update(schema.users)
        .set({ accessCode: code.code, creditExempt: true })
        .where(eq(schema.users.id, userId));
      await tx.insert(schema.auditEvents).values({
        ownerId: userId,
        type: "access_code.redeemed",
        subjectId: userId,
        data: { code: code.code },
      });
      return { alreadyRedeemed: false };
    },
  );
}

/** What the header, billing page and studio need to know about the user's access. */
export async function accessOf(userId: string) {
  const { db } = await runtime();
  const u = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { role: true, creditExempt: true, accessCode: true },
  });
  return { admin: u?.role === "admin", unlimited: u?.creditExempt === true, beta: Boolean(u?.accessCode) };
}

/** Admin overview: users and how each access code is used. */
export async function adminOverview() {
  const { db } = await runtime();
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      creditExempt: schema.users.creditExempt,
      accessCode: schema.users.accessCode,
      createdAt: schema.users.createdAt,
      projects: sql<number>`(select count(*)::int from ${schema.projects} where ${schema.projects.ownerId} = ${schema.users.id})`,
    })
    .from(schema.users)
    .orderBy(sql`${schema.users.createdAt} desc`)
    .limit(200);
  const codes = parseAccessCodes(process.env.SHORTLOOP_ACCESS_CODES).map((c) => ({
    code: c.code,
    maxUses: c.maxUses,
    used: users.filter((u) => u.accessCode === c.code).length,
  }));
  return { users, codes, admins: [...parseAdminEmails(process.env.ADMIN_EMAILS)].length };
}
