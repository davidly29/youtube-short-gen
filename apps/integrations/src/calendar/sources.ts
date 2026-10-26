import { rowsFromGoogleSheets, rowsFromNotion, type CalendarRow, type NotionPage } from "./rows";

/**
 * Read a content calendar from Google Sheets or Notion with the user's own credentials. These run on the user's
 * machine (the import CLI), like the SDK, and never on ShortLoop's servers. Pass `fetch` to test without a network.
 */

export interface SheetSource {
  spreadsheetId: string;
  /** A1 range, default the first sheet's columns A–Z. */
  range?: string;
  /** A Google API key (sheet shared "anyone with the link") or an OAuth access token. */
  apiKey?: string;
  accessToken?: string;
  fetch?: typeof fetch;
}

export async function readGoogleSheet(src: SheetSource): Promise<CalendarRow[]> {
  if (!src.apiKey && !src.accessToken) throw new Error("Set GOOGLE_SHEETS_API_KEY or GOOGLE_ACCESS_TOKEN.");
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(src.spreadsheetId)}/values/${encodeURIComponent(src.range ?? "A:Z")}`,
  );
  // Unformatted values give dates as serial numbers, so "02/11/2026" can't be misread as 11 Feb.
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");
  if (src.apiKey) url.searchParams.set("key", src.apiKey);
  const headers: Record<string, string> = { accept: "application/json" };
  if (src.accessToken) headers.authorization = `Bearer ${src.accessToken}`;
  const res = await (src.fetch ?? fetch)(url.toString(), { headers });
  const json = (await res.json().catch(() => ({}))) as {
    values?: unknown[][];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Google Sheets: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return rowsFromGoogleSheets({
    values: (json.values ?? []).map((r) => r.map((c) => (c === null ? "" : String(c)))),
  });
}

export interface NotionSource {
  databaseId: string;
  /** An internal integration token the database is shared with. */
  token: string;
  fetch?: typeof fetch;
}

export const NOTION_VERSION = "2022-06-28";

/** All rows of a Notion database, oldest first, following pagination. */
export async function readNotionDatabase(src: NotionSource): Promise<CalendarRow[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await (src.fetch ?? fetch)(
      `https://api.notion.com/v1/databases/${encodeURIComponent(src.databaseId)}/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${src.token}`,
          "notion-version": NOTION_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          sorts: [{ timestamp: "created_time", direction: "ascending" }],
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      results?: NotionPage[];
      has_more?: boolean;
      next_cursor?: string | null;
      message?: string;
    };
    if (!res.ok) throw new Error(`Notion: ${json.message ?? `HTTP ${res.status}`}`);
    pages.push(...(json.results ?? []));
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return rowsFromNotion(pages);
}
