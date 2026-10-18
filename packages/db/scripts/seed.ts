import { defaultDatabaseUrl, openDb } from "../src/client";
import { seed } from "../src/seed";

const handle = openDb(defaultDatabaseUrl());
await handle.migrate();
await seed(handle.db);
await handle.close();
console.log("seeded");
