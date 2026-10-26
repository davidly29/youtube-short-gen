import { CreateShortInput } from "@shortloop/mcp";
import type { CreateShortInputBody, CreateShortOutput } from "@shortloop/sdk-ts";
import { CREATE_SHORT_FIELDS, toCreateShortBody } from "../fields";
import type { CalendarRow } from "./rows";

/** Column names we recognise (lower case). The first alias is the one the template sheet uses. */
export const COLUMN_ALIASES: Record<string, string[]> = {
  topic: ["topic", "idea", "title", "subject"],
  angle: ["angle", "take", "framing"],
  length_seconds: ["length", "length (s)", "length_seconds", "duration", "seconds"],
  tone: ["tone"],
  caption_style: ["caption style", "captions", "caption_style"],
  image_style: ["image style", "look", "image_style", "visual style"],
  voice_id: ["voice", "voice id", "voice_id"],
  channel_voice_id: ["channel voice", "channel_voice_id"],
  topic_id: ["topic id", "topic_id", "brief idea id"],
  date: ["date", "publish date", "publish on", "planned for", "scheduled"],
  status: ["status", "state"],
};

/** Rows whose Status says they're handled are left alone. */
export const DONE_STATUSES = [
  "done",
  "made",
  "published",
  "posted",
  "skip",
  "skipped",
  "cancelled",
  "canceled",
];
export const DEFAULT_IMPORT_LIMIT = 50;

export interface RowError {
  row: number;
  /** The column the problem is in, as the user named it. */
  column?: string;
  message: string;
  ref?: string;
}
export interface PlannedShort {
  row: number;
  ref?: string;
  /** YYYY-MM-DD from the Date column, when there is one. */
  date?: string;
  input: CreateShortInputBody;
}
export interface MappedCalendar {
  planned: PlannedShort[];
  errors: RowError[];
  skipped: { row: number; reason: string; ref?: string }[];
}

export interface MapOptions {
  /** Skip rows dated before this day (YYYY-MM-DD). */
  from?: string;
  /** At most this many Shorts per import (each uses a credit). */
  limit?: number;
}

/** Find which of the user's columns holds each field. */
export function resolveColumns(rows: CalendarRow[]): Partial<Record<string, string>> {
  const seen = new Set(rows.flatMap((r) => Object.keys(r.values)));
  const out: Partial<Record<string, string>> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const hit = aliases.find((a) => seen.has(a));
    if (hit) out[field] = hit;
  }
  return out;
}

/** "2026-11-02", "2026-11-02T09:00:00Z" or a Sheets date serial (46000) → "2026-11-02". */
export function parseDate(v: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return d.getUTCMonth() === Number(iso[2]) - 1 && d.getUTCDate() === Number(iso[3])
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : undefined;
  }
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Math.floor(Number(v));
    if (serial < 20000 || serial > 80000) return undefined;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return undefined;
}

const labelFor = (field: string) => CREATE_SHORT_FIELDS.find((f) => f.key === field)?.label ?? field;

/**
 * Check every row and turn the good ones into `POST /shorts` bodies. Nothing is sent: problems come back per row
 * with the column they're in, so the user can fix the sheet and run it again.
 */
export function mapCalendar(rows: CalendarRow[], opts: MapOptions = {}): MappedCalendar {
  const out: MappedCalendar = { planned: [], errors: [], skipped: [] };
  const cols = resolveColumns(rows);
  if (!cols.topic) {
    out.errors.push({
      row: 1,
      message: `No Topic column. Name one column "Topic" (also accepted: ${COLUMN_ALIASES.topic?.slice(1).join(", ")}).`,
    });
    return out;
  }
  const limit = opts.limit ?? DEFAULT_IMPORT_LIMIT;
  const topics = new Map<string, number>();

  for (const r of rows) {
    const get = (field: string) => {
      const col = cols[field];
      return col ? (r.values[col] ?? "") : "";
    };
    const status = get("status").toLowerCase();
    if (status && DONE_STATUSES.includes(status)) {
      out.skipped.push({ row: r.row, ref: r.ref, reason: `Status is "${get("status")}"` });
      continue;
    }
    const rowErrors: RowError[] = [];
    let date: string | undefined;
    const rawDate = get("date");
    if (rawDate) {
      date = parseDate(rawDate);
      if (!date)
        rowErrors.push({
          row: r.row,
          ref: r.ref,
          column: cols.date,
          message: `"${rawDate}" isn't a date; use YYYY-MM-DD.`,
        });
    }
    if (date && opts.from && date < opts.from) {
      out.skipped.push({ row: r.row, ref: r.ref, reason: `dated ${date}, before ${opts.from}` });
      continue;
    }

    const values: Record<string, string> = {};
    for (const f of CREATE_SHORT_FIELDS) values[f.key] = get(f.key);
    const body = toCreateShortBody(values);
    const parsed = CreateShortInput.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        rowErrors.push({
          row: r.row,
          ref: r.ref,
          column: cols[field] ?? labelFor(field),
          message: fieldMessage(field, body[field], issue.message),
        });
      }
    }

    const topicKey = get("topic").toLowerCase().replace(/\s+/g, " ");
    const firstRow = topicKey ? topics.get(topicKey) : undefined;
    if (firstRow !== undefined)
      rowErrors.push({
        row: r.row,
        ref: r.ref,
        column: cols.topic,
        message: `Same topic as row ${firstRow}; near-duplicate Shorts are blocked by the variation guard.`,
      });
    else if (topicKey) topics.set(topicKey, r.row);

    if (rowErrors.length) {
      out.errors.push(...rowErrors);
      continue;
    }
    if (out.planned.length >= limit) {
      out.skipped.push({ row: r.row, ref: r.ref, reason: `over the limit of ${limit} Shorts per import` });
      continue;
    }
    out.planned.push({
      row: r.row,
      ref: r.ref,
      ...(date ? { date } : {}),
      input: body as CreateShortInputBody,
    });
  }
  return out;
}

function fieldMessage(field: string, value: unknown, fallback: string): string {
  switch (field) {
    case "topic":
      return value === undefined ? "Topic is empty." : "Topic must be 3–300 characters.";
    case "length_seconds":
      return "Length must be 30, 45 or 60 seconds.";
    case "caption_style":
      return `Caption style must be one of: ${CREATE_SHORT_FIELDS.find((f) => f.key === "caption_style")
        ?.choices?.map((c) => c.value)
        .join(", ")}.`;
    case "tone":
      return "Tone must be 2–40 characters.";
    case "topic_id":
      return "Topic ID must look like top_… (copy it from a brief idea).";
    default:
      return fallback;
  }
}

/** The bit of the SDK client the import needs (a fake in tests). */
export interface ShortCreator {
  createShort(body: CreateShortInputBody): Promise<CreateShortOutput>;
}

export interface ImportReport extends MappedCalendar {
  created: { row: number; ref?: string; date?: string; project_id: string; app_url?: string }[];
  dryRun: boolean;
}

/**
 * Create a Short per planned row, one at a time (the SDK waits out rate limits). Stops early when the key is
 * rejected or credits run out, marking the remaining rows as not created.
 */
export async function importCalendar(
  mapped: MappedCalendar,
  client: ShortCreator,
  opts: { dryRun: boolean },
): Promise<ImportReport> {
  const report: ImportReport = {
    planned: mapped.planned,
    errors: [...mapped.errors],
    skipped: [...mapped.skipped],
    created: [],
    dryRun: opts.dryRun,
  };
  if (opts.dryRun) return report;
  let stop: string | undefined;
  for (const p of mapped.planned) {
    if (stop) {
      report.skipped.push({ row: p.row, ref: p.ref, reason: `not created: ${stop}` });
      continue;
    }
    try {
      const res = await client.createShort(p.input);
      report.created.push({
        row: p.row,
        ref: p.ref,
        ...(p.date ? { date: p.date } : {}),
        project_id: res.project_id,
        ...(res.app_url ? { app_url: res.app_url } : {}),
      });
    } catch (e) {
      const err = e as { message?: string; status?: number };
      const message = err.message ?? String(e);
      report.errors.push({ row: p.row, ref: p.ref, message: `ShortLoop refused it: ${message}` });
      if (err.status === 401 || err.status === 403) stop = "the API key was rejected";
      else if (/credit/i.test(message)) stop = "out of credits";
    }
  }
  return report;
}

/** A plain-text report, one line per row, in row order. */
export function formatReport(report: ImportReport): string {
  const lines: { row: number; text: string }[] = [];
  const at = (row: number, ref?: string) => `Row ${row}${ref ? ` (${ref})` : ""}`;
  for (const c of report.created)
    lines.push({
      row: c.row,
      text: `${at(c.row, c.ref)}: created ${c.project_id}${c.app_url ? ` → ${c.app_url}` : ""}`,
    });
  if (report.dryRun)
    for (const p of report.planned)
      lines.push({
        row: p.row,
        text: `${at(p.row, p.ref)}: ok, would create "${p.input.topic}"${p.date ? ` (${p.date})` : ""}`,
      });
  for (const e of report.errors)
    lines.push({
      row: e.row,
      text: `${at(e.row, e.ref)}: error${e.column ? ` in ${e.column}` : ""}: ${e.message}`,
    });
  for (const s of report.skipped)
    lines.push({ row: s.row, text: `${at(s.row, s.ref)}: skipped, ${s.reason}` });
  lines.sort((a, b) => a.row - b.row);
  const rowsWithErrors = new Set(report.errors.map((e) => e.row)).size;
  const summary = report.dryRun
    ? `Dry run: ${report.planned.length} ready, ${rowsWithErrors} with errors, ${report.skipped.length} skipped. Run again with --yes to create them (1 credit each).`
    : `${report.created.length} created, ${rowsWithErrors} with errors, ${report.skipped.length} skipped.`;
  return [...lines.map((l) => l.text), summary].join("\n");
}
