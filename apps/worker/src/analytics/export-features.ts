/**
 * Export the feature store (E10-02) with each Short's metric totals to Parquet for offline analysis:
 *   pnpm -F @shortloop/worker export:features [out.parquet] [--owner <userId>]
 * Reads DATABASE_URL (or the local default). Writes `shorts-features-<date>.parquet` by default.
 */
import { writeFile } from "node:fs/promises";
import { defaultDatabaseUrl, openDb } from "@shortloop/db";
import { exportFeaturesParquet, syncFeatures } from "@shortloop/pipeline";

const args = process.argv.slice(2);
const ownerAt = args.indexOf("--owner");
const ownerId = ownerAt >= 0 ? args[ownerAt + 1] : undefined;
const out =
  args.find((a, i) => !a.startsWith("--") && (ownerAt < 0 || i !== ownerAt + 1)) ??
  `shorts-features-${new Date().toISOString().slice(0, 10)}.parquet`;

const handle = openDb(process.env.DATABASE_URL ?? defaultDatabaseUrl());
try {
  await handle.migrate();
  const added = await syncFeatures(handle.db); // any live Short still missing its row
  const bytes = await exportFeaturesParquet(handle.db, { ownerId });
  await writeFile(out, bytes);
  console.log(`wrote ${out} (${bytes.byteLength} bytes; ${added} feature rows added first)`);
} finally {
  await handle.close();
}
