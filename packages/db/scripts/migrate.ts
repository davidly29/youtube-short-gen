import { defaultDatabaseUrl, openDb } from "../src/client";

const url = defaultDatabaseUrl();
const handle = openDb(url);
await handle.migrate();
await handle.close();
console.log(`migrated ${url.startsWith("postgres") ? "Postgres" : `PGlite at ${url}`}`);
