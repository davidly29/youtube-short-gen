import "server-only";
import { schema } from "@shortloop/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "./runtime";

export const FREE_SHORTS_ON_SIGNUP = 5;

async function build() {
  const { db } = await runtime();
  const google =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
      : undefined;
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db as never, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    // On by default in production; e2e turns it off because every test signs up a fresh user.
    rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== "off" },
    // Railway's edge proxy sets these; without them every visitor shares one rate-limit bucket.
    advanced: {
      ipAddress: {
        ipAddressHeaders: (process.env.AUTH_IP_HEADERS ?? "x-real-ip,x-forwarded-for")
          .split(",")
          .map((h) => h.trim()),
      },
      database: { generateId: () => `usr_${crypto.randomUUID()}` },
    },
    socialProviders: google,
    databaseHooks: {
      user: {
        create: {
          // First sign-in: a personal workspace with 5 free Shorts (E1-01).
          after: async (user) => {
            await db
              .insert(schema.creditLedger)
              .values({ ownerId: user.id, unit: "short", delta: FREE_SHORTS_ON_SIGNUP, reason: "signup" });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = Awaited<ReturnType<typeof build>>;
const g = globalThis as unknown as { __shortloopAuth?: Promise<Auth> };
export function auth(): Promise<Auth> {
  g.__shortloopAuth ??= build();
  return g.__shortloopAuth;
}

export async function getSession() {
  return (await auth()).api.getSession({ headers: await headers() });
}

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}
