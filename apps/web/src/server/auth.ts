import "server-only";
import { schema } from "@shortloop/db";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { runtime } from "./runtime";

export const FREE_SHORTS_ON_SIGNUP = 5;

/** The app's public origin (tokens for MCP clients are bound to `${origin}/api/mcp`). */
export const appOrigin = () => new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
export const mcpResource = () => `${appOrigin()}/api/mcp`;

const ID_PREFIX: Record<string, string> = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
};

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
        jwks: schema.authJwks,
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,
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
      database: {
        generateId: ({ model }) =>
          `${ID_PREFIX[model] ?? model.replace(/[^a-z]/gi, "").slice(0, 8)}_${crypto.randomUUID()}`,
      },
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
    plugins: [
      // MCP clients (Claude, ChatGPT, Cursor, ...) sign users in with OAuth 2.1 against these same accounts (E9-01).
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        resource: mcpResource(),
        // Clients identify themselves with a Client ID Metadata Document (MCP 2026-07-28) or register dynamically.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      nextCookies(),
    ],
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
