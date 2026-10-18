import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema";

/**
 * Where the SQL migrations live. Override with SHORTLOOP_MIGRATIONS_DIR when this file is bundled
 * (a `new URL("../drizzle", import.meta.url)` literal is treated as an asset by bundlers like Turbopack).
 */
export const MIGRATIONS_FOLDER =
  process.env.SHORTLOOP_MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export type Db =
  ReturnType<typeof drizzlePglite<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>;

export interface DbHandle {
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Open a database.
 * - `postgres://…` / `postgresql://…`: real Postgres (staging, production).
 * - anything else: an embedded PGlite database (`memory://` for tests, or a directory path for local dev).
 */
export function openDb(url: string): DbHandle {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => pool.end(),
    };
  }
  const client = new PGlite(url === "memory://" ? undefined : url);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

/** DATABASE_URL, or a local PGlite directory for development. */
export const defaultDatabaseUrl = () => process.env.DATABASE_URL ?? "./.pglite";
