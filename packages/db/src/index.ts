/** @shortloop/db: Drizzle schema, migrations, and Postgres/PGlite clients. */
export const PACKAGE_NAME = "@shortloop/db" as const;

export * as schema from "./schema";
export { defaultDatabaseUrl, MIGRATIONS_FOLDER, openDb, type Db, type DbHandle } from "./client";
export { toAsset, toJob, toPublishRequest, toScript, toTimeline } from "./mappers";
export { balance, type CreditUnit } from "./ledger";
export { seed, SEED } from "./seed";
export {
  ensureTrendsOwner,
  hourBucket,
  insertSignals,
  pruneSignals,
  toTrendSignal,
  TREND_RETENTION_DAYS,
  TRENDS_OWNER_ID,
} from "./trends";

/** Query helpers re-exported so every package uses this package's drizzle-orm instance. */
export { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, sum } from "drizzle-orm";
