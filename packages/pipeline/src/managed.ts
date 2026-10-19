import {
  AiUsage,
  MANAGED_DENIAL_MESSAGE,
  MANAGED_LIMITS,
  PlanId,
  PREMIUM_PER_SHORT_USD,
  type ManagedDenial,
  type ManagedLimits,
  type ManagedTier,
  type ProviderCapability,
} from "@shortloop/contracts";
import { and, eq, gte, ne, schema, sql, type Db } from "@shortloop/db";
import { reportError } from "./tracing";

/**
 * ShortLoop AI guardrails (ADR 0007): who gets AI on ShortLoop's keys, how much they may spend, and the ledger of
 * what they did spend. Every check reads the append-only `ai_usage` ledger, so limits hold across web and worker.
 */

const ACTIVE = new Set(["active", "trialing"]);

/**
 * The user's ShortLoop AI tier, or undefined when their plan doesn't include it. Admins always do; beta
 * access-code holders only when they also pay (owner decision 2026-10-19).
 */
export async function managedTier(db: Db, ownerId: string): Promise<ManagedTier | undefined> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, ownerId),
    columns: { role: true },
  });
  if (user?.role === "admin") return "admin";
  const sub = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.userId, ownerId) });
  if (!sub || !ACTIVE.has(sub.status)) return undefined;
  const plan = PlanId.safeParse(sub.plan);
  return plan.success ? plan.data : undefined;
}

export function limitsFor(tier: ManagedTier, env: NodeJS.ProcessEnv = process.env): ManagedLimits {
  const base = MANAGED_LIMITS[tier];
  const adminCap = Number(env.MANAGED_ADMIN_MONTHLY_USD);
  return tier === "admin" && adminCap > 0 ? { ...base, monthlyUsd: adminCap } : base;
}

/** USD; default $25 a day across all users. */
export const platformDailyBudget = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.MANAGED_AI_DAILY_BUDGET_USD);
  return n > 0 ? n : 25;
};

const startOfDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function sumCost(db: Db, where: ReturnType<typeof and>): Promise<number> {
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)::float8` })
    .from(schema.aiUsage)
    .where(where);
  return Number(r?.usd ?? 0);
}

async function count(db: Db, expr: ReturnType<typeof sql<number>>, where: ReturnType<typeof and>) {
  const [r] = await db.select({ n: expr }).from(schema.aiUsage).where(where);
  return Number(r?.n ?? 0);
}

export interface BudgetContext {
  ownerId: string;
  tier: ManagedTier;
  projectId?: string;
  /** The current job; its own earlier calls don't count towards "scripts per Short". */
  jobId?: string;
  /** A visual swap on the review screen. */
  swap?: boolean;
  /** This Short spent an AI-video credit on premium images (raises its per-Short limit). */
  premium?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

let alertedDay = "";

/**
 * Whether ShortLoop AI may make one more call of `capability` now. Returns why not, or undefined when allowed.
 * Order: kill switch, platform daily budget, user's month, project's limit, Shorts per day, swaps, scripts.
 */
export async function managedDenial(
  db: Db,
  ctx: BudgetContext,
  capability: ProviderCapability,
): Promise<ManagedDenial | undefined> {
  const env = ctx.env ?? process.env;
  const now = ctx.now ?? new Date();
  if (env.MANAGED_AI_ENABLED !== "1") return "disabled";
  const limits = limitsFor(ctx.tier, env);
  const today = startOfDay(now).toISOString();
  const month = startOfMonth(now).toISOString();
  const u = schema.aiUsage;

  const platformToday = await sumCost(db, and(gte(u.createdAt, today)));
  if (platformToday >= platformDailyBudget(env)) {
    if (alertedDay !== today) {
      alertedDay = today;
      reportError(new Error(`ShortLoop AI platform budget reached: $${platformToday.toFixed(2)} today`));
    }
    return "platform_budget";
  }
  if ((await sumCost(db, and(eq(u.ownerId, ctx.ownerId), gte(u.createdAt, month)))) >= limits.monthlyUsd)
    return "monthly_cap";
  if (ctx.projectId) {
    const cap = ctx.premium ? Math.max(PREMIUM_PER_SHORT_USD, limits.perShortUsd) : limits.perShortUsd;
    if ((await sumCost(db, and(eq(u.projectId, ctx.projectId)))) >= cap) return "per_short";
    const otherProjectsToday = await count(
      db,
      sql<number>`count(distinct ${u.projectId})::int`,
      and(eq(u.ownerId, ctx.ownerId), gte(u.createdAt, today), ne(u.projectId, ctx.projectId)),
    );
    const thisProjectToday = await count(
      db,
      sql<number>`count(*)::int`,
      and(eq(u.projectId, ctx.projectId), gte(u.createdAt, today)),
    );
    // A Short already started today on ShortLoop AI can finish; a new one counts against the daily limit.
    if (thisProjectToday === 0 && otherProjectsToday >= limits.shortsPerDay) return "daily_shorts";
    if (ctx.swap && capability === "image") {
      const swaps = await count(
        db,
        sql<number>`count(*)::int`,
        and(eq(u.projectId, ctx.projectId), eq(u.swap, true)),
      );
      if (swaps >= limits.imageSwapsPerShort) return "swaps";
    }
    if (capability === "llm") {
      const scriptJobs = await count(
        db,
        sql<number>`count(distinct ${u.jobId})::int`,
        and(
          eq(u.projectId, ctx.projectId),
          eq(u.capability, "llm"),
          ...(ctx.jobId ? [ne(u.jobId, ctx.jobId)] : []),
        ),
      );
      if (scriptJobs >= limits.scriptsPerShort) return "scripts";
    }
  }
  return undefined;
}

/** The message shown when ShortLoop AI is denied: what happened, and what we did instead. */
export function managedDenialMessage(denial: ManagedDenial, capability: ProviderCapability): string {
  const base = MANAGED_DENIAL_MESSAGE[denial];
  if (capability === "llm")
    return `${base} Add your own AI key in Settings → API keys, or write the script yourself.`;
  return `${base} Using the free ${capability === "image" ? "images" : "voices"} instead.`;
}

export async function recordAiUsage(db: Db, row: AiUsage): Promise<void> {
  const r = AiUsage.parse(row);
  await db.insert(schema.aiUsage).values({
    ownerId: r.ownerId,
    projectId: r.projectId ?? null,
    jobId: r.jobId ?? null,
    capability: r.capability,
    provider: r.provider,
    model: r.model,
    units: r.units,
    costUsd: r.costUsd,
    swap: r.swap,
  });
}

export interface ManagedUsageSummary {
  todayUsd: number;
  monthUsd: number;
  dailyBudgetUsd: number;
  enabled: boolean;
  users: { ownerId: string; email?: string; monthUsd: number; calls: number }[];
}

/** For the Admin page: spend today and this month, and the top spenders this month. */
export async function managedUsageSummary(
  db: Db,
  opts: { now?: Date; env?: NodeJS.ProcessEnv; limit?: number } = {},
): Promise<ManagedUsageSummary> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const u = schema.aiUsage;
  const month = startOfMonth(now).toISOString();
  const rows = await db
    .select({
      ownerId: u.ownerId,
      email: schema.users.email,
      usd: sql<number>`sum(${u.costUsd})::float8`,
      calls: sql<number>`count(*)::int`,
    })
    .from(u)
    .leftJoin(schema.users, eq(schema.users.id, u.ownerId))
    .where(gte(u.createdAt, month))
    .groupBy(u.ownerId, schema.users.email)
    .orderBy(sql`sum(${u.costUsd}) desc`)
    .limit(opts.limit ?? 20);
  return {
    todayUsd: await sumCost(db, and(gte(u.createdAt, startOfDay(now).toISOString()))),
    monthUsd: await sumCost(db, and(gte(u.createdAt, month))),
    dailyBudgetUsd: platformDailyBudget(env),
    enabled: env.MANAGED_AI_ENABLED === "1",
    users: rows.map((r) => ({
      ownerId: r.ownerId,
      email: r.email ?? undefined,
      monthUsd: Number(r.usd),
      calls: Number(r.calls),
    })),
  };
}

/** This user's ShortLoop AI spend this month and their limit, for Settings. */
export async function managedAllowance(
  db: Db,
  ownerId: string,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<{ tier?: ManagedTier; usedUsd: number; limitUsd?: number; enabled: boolean }> {
  const env = opts.env ?? process.env;
  const tier = await managedTier(db, ownerId);
  const usedUsd = await sumCost(
    db,
    and(
      eq(schema.aiUsage.ownerId, ownerId),
      gte(schema.aiUsage.createdAt, startOfMonth(opts.now ?? new Date()).toISOString()),
    ),
  );
  return {
    tier,
    usedUsd,
    limitUsd: tier ? limitsFor(tier, env).monthlyUsd : undefined,
    enabled: env.MANAGED_AI_ENABLED === "1",
  };
}
