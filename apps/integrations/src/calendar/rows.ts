/**
 * Content-calendar rows from a Google Sheet or a Notion database, normalised to `{ row, values }` with lower-case
 * column names. Pure functions: fetching lives in `sources.ts`.
 */

export interface CalendarRow {
  /** Where the user finds this row: the sheet row number (header = 1) or the Notion row's position. */
  row: number;
  /** Lower-cased, trimmed column name → cell text. */
  values: Record<string, string>;
  /** Notion page id, so the report can link back. */
  ref?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** RFC 4180 CSV (quotes, doubled quotes, CRLF, a leading BOM). Works for "Download as CSV" from Sheets or Notion. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A table whose first non-empty row is the header. Blank rows are skipped but keep their numbers. */
export function rowsFromTable(table: string[][]): CalendarRow[] {
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx < 0) return [];
  const header = (table[headerIdx] ?? []).map(norm);
  const out: CalendarRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (!cells.some((c) => c.trim())) continue;
    const values: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) values[h] = (cells[j] ?? "").trim();
    });
    out.push({ row: i + 1, values });
  }
  return out;
}

/** Google Sheets API `spreadsheets.values.get` response. */
export function rowsFromGoogleSheets(res: { values?: string[][] }): CalendarRow[] {
  return rowsFromTable(res.values ?? []);
}

// Notion database query results: only the property types a content calendar uses.
type RichText = { plain_text?: string }[];
export interface NotionProperty {
  type: string;
  title?: RichText;
  rich_text?: RichText;
  select?: { name?: string } | null;
  status?: { name?: string } | null;
  multi_select?: { name?: string }[];
  number?: number | null;
  date?: { start?: string } | null;
  url?: string | null;
  checkbox?: boolean;
}
export interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

export function notionValue(p: NotionProperty): string {
  const text = (rt?: RichText) => (rt ?? []).map((t) => t.plain_text ?? "").join("");
  switch (p.type) {
    case "title":
      return text(p.title);
    case "rich_text":
      return text(p.rich_text);
    case "select":
      return p.select?.name ?? "";
    case "status":
      return p.status?.name ?? "";
    case "multi_select":
      return (p.multi_select ?? []).map((o) => o.name ?? "").join(", ");
    case "number":
      return p.number === null || p.number === undefined ? "" : String(p.number);
    case "date":
      return p.date?.start ?? "";
    case "url":
      return p.url ?? "";
    case "checkbox":
      return p.checkbox ? "true" : "false";
    default:
      return "";
  }
}

export function rowsFromNotion(pages: NotionPage[]): CalendarRow[] {
  return pages.map((page, i) => ({
    row: i + 1,
    ref: page.id,
    values: Object.fromEntries(
      Object.entries(page.properties).map(([k, p]) => [norm(k), notionValue(p).trim()]),
    ),
  }));
}
