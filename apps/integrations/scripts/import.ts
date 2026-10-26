/**
 * Import a content calendar into ShortLoop: one Short per row (pnpm -F integrations import:calendar --csv calendar.csv).
 *
 *   --csv <file>            a CSV downloaded from Google Sheets or exported from Notion
 *   --sheet <id> [--range]  a Google Sheet (GOOGLE_SHEETS_API_KEY or GOOGLE_ACCESS_TOKEN)
 *   --notion <database id>  a Notion database shared with your integration (NOTION_TOKEN)
 *   --from YYYY-MM-DD       skip rows dated before this day ("today" works)
 *   --limit N               at most N Shorts (default 50)
 *   --yes                   actually create them; without it this is a dry run that only checks the rows
 *
 * Needs SHORTLOOP_API_URL and SHORTLOOP_API_KEY (Settings → Developer). Exit code 1 when any row has an error.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ShortLoop } from "@shortloop/sdk-ts";
import { formatReport, importCalendar, mapCalendar } from "../src/calendar/import";
import { parseCsv, rowsFromTable, type CalendarRow } from "../src/calendar/rows";
import { readGoogleSheet, readNotionDatabase } from "../src/calendar/sources";

const { values: args } = parseArgs({
  options: {
    csv: { type: "string" },
    sheet: { type: "string" },
    range: { type: "string" },
    notion: { type: "string" },
    from: { type: "string" },
    limit: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

async function readRows(): Promise<CalendarRow[]> {
  if (args.csv) return rowsFromTable(parseCsv(readFileSync(args.csv, "utf8")));
  if (args.sheet)
    return readGoogleSheet({
      spreadsheetId: args.sheet,
      ...(args.range ? { range: args.range } : {}),
      ...(process.env.GOOGLE_SHEETS_API_KEY ? { apiKey: process.env.GOOGLE_SHEETS_API_KEY } : {}),
      ...(process.env.GOOGLE_ACCESS_TOKEN ? { accessToken: process.env.GOOGLE_ACCESS_TOKEN } : {}),
    });
  if (args.notion) {
    const token = process.env.NOTION_TOKEN;
    if (!token)
      throw new Error("Set NOTION_TOKEN to an internal integration token the database is shared with.");
    return readNotionDatabase({ databaseId: args.notion, token });
  }
  throw new Error("Pass --csv <file>, --sheet <spreadsheet id> or --notion <database id>.");
}

const from = args.from === "today" ? new Date().toISOString().slice(0, 10) : args.from;
const mapped = mapCalendar(await readRows(), {
  ...(from ? { from } : {}),
  ...(args.limit ? { limit: Number(args.limit) } : {}),
});
const report = await importCalendar(
  mapped,
  args.yes ? new ShortLoop() : { createShort: () => Promise.reject() },
  {
    dryRun: !args.yes,
  },
);
console.log(formatReport(report));
process.exitCode = report.errors.length ? 1 : 0;
