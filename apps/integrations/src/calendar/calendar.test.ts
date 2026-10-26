import { CreateShortInput } from "@shortloop/mcp";
import { describe, expect, it } from "vitest";
import { formatReport, importCalendar, mapCalendar, parseDate, type ShortCreator } from "./import";
import { parseCsv, rowsFromGoogleSheets, rowsFromNotion, rowsFromTable, type NotionPage } from "./rows";
import { readGoogleSheet, readNotionDatabase } from "./sources";

const CSV = [
  "\uFEFFDate,Topic,Angle,Length,Caption style,Status",
  '2026-11-02,Why octopuses have three hearts,"The ""blue blood"" bit",45,bold-pop,Planned',
  "2026-11-03,,,30,,Planned", // row 3: no topic
  "2026-11-04,The Great Emu War,,90,glitter,Idea", // row 4: bad length and caption style
  ",,,,,", // row 5: blank, skipped silently
  "next tuesday,Honey never spoils,,60,,", // row 6: bad date
  "2026-11-06,Why octopuses have THREE hearts,,30,,", // row 7: duplicate of row 2
  "2026-11-07,Old idea,,30,,Published", // row 8: already done
  "2026-11-08,Why the sky is blue,,0:30,karaoke,",
].join("\r\n");

describe("content-calendar rows", () => {
  it("parses CSV exports with quotes, doubled quotes, CRLF and a BOM", () => {
    const t = parseCsv('a,b\r\n"x, y","say ""hi"""\n');
    expect(t).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    const rows = rowsFromTable(parseCsv(CSV));
    expect(rows[0]).toEqual({
      row: 2,
      values: {
        date: "2026-11-02",
        topic: "Why octopuses have three hearts",
        angle: 'The "blue blood" bit',
        length: "45",
        "caption style": "bold-pop",
        status: "Planned",
      },
    });
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 6, 7, 8, 9]);
  });

  it("reads Google Sheets values and Notion properties into the same shape", () => {
    expect(rowsFromGoogleSheets({ values: [["Topic", "Length"], [], ["Honey never spoils", "30"]] })).toEqual(
      [{ row: 3, values: { topic: "Honey never spoils", length: "30" } }],
    );
    const page: NotionPage = {
      id: "pg_1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Honey " }, { plain_text: "never spoils" }] },
        Length: { type: "number", number: 45 },
        Status: { type: "status", status: { name: "Planned" } },
        "Publish date": { type: "date", date: { start: "2026-11-02" } },
        Tags: { type: "multi_select", multi_select: [{ name: "food" }, { name: "history" }] },
        Angle: { type: "rich_text", rich_text: [] },
      },
    };
    expect(rowsFromNotion([page])).toEqual([
      {
        row: 1,
        ref: "pg_1",
        values: {
          name: "Honey never spoils",
          length: "45",
          status: "Planned",
          "publish date": "2026-11-02",
          tags: "food, history",
          angle: "",
        },
      },
    ]);
  });

  it("parses ISO dates and Sheets date serials, nothing ambiguous", () => {
    expect(parseDate("2026-11-02")).toBe("2026-11-02");
    expect(parseDate("2026-11-02T09:30:00.000Z")).toBe("2026-11-02");
    expect(parseDate("46328")).toBe("2026-11-02");
    expect(parseDate("2026-02-30")).toBeUndefined();
    expect(parseDate("02/11/2026")).toBeUndefined();
  });
});

describe("mapping rows to Shorts (E12-03)", () => {
  const mapped = mapCalendar(rowsFromTable(parseCsv(CSV)));

  it("turns good rows into valid POST /shorts bodies", () => {
    expect(mapped.planned.map((p) => p.row)).toEqual([2, 9]);
    expect(mapped.planned[0]).toEqual({
      row: 2,
      date: "2026-11-02",
      input: {
        topic: "Why octopuses have three hearts",
        angle: 'The "blue blood" bit',
        length_seconds: 45,
        caption_style: "bold-pop",
      },
    });
    expect(mapped.planned[1]?.input).toMatchObject({ length_seconds: 30, caption_style: "karaoke" });
    for (const p of mapped.planned) expect(CreateShortInput.safeParse(p.input).success).toBe(true);
  });

  it("reports every problem on its own row, in the user's column names", () => {
    expect(mapped.errors).toEqual([
      { row: 3, column: "topic", message: "Topic is empty." },
      { row: 4, column: "length", message: "Length must be 30, 45 or 60 seconds." },
      {
        row: 4,
        column: "caption style",
        message:
          "Caption style must be one of: bold-pop, clean-subtitle, highlight-word, karaoke, boxed, minimal.",
      },
      { row: 6, column: "date", message: '"next tuesday" isn\'t a date; use YYYY-MM-DD.' },
      {
        row: 7,
        column: "topic",
        message: "Same topic as row 2; near-duplicate Shorts are blocked by the variation guard.",
      },
    ]);
    expect(mapped.skipped).toEqual([{ row: 8, reason: 'Status is "Published"' }]);
  });

  it("needs a Topic column", () => {
    const m = mapCalendar(
      rowsFromTable([
        ["Idea name", "Length"],
        ["x", "30"],
      ]),
    );
    expect(m.planned).toEqual([]);
    expect(m.errors[0]?.message).toMatch(/No Topic column/);
  });

  it("can skip past rows and caps a run", () => {
    const rows = rowsFromTable(parseCsv(CSV));
    // Row 7 is no longer a duplicate once row 2 is out of range.
    expect(mapCalendar(rows, { from: "2026-11-05" }).planned.map((p) => p.row)).toEqual([7, 9]);
    const capped = mapCalendar(rows, { limit: 1 });
    expect(capped.planned.map((p) => p.row)).toEqual([2]);
    expect(capped.skipped).toContainEqual({ row: 9, reason: "over the limit of 1 Shorts per import" });
  });
});

describe("importing (E12-03)", () => {
  const mapped = mapCalendar(rowsFromTable(parseCsv(CSV)));

  it("a dry run creates nothing and says what it would do", async () => {
    const client: ShortCreator = { createShort: () => Promise.reject(new Error("must not be called")) };
    const report = await importCalendar(mapped, client, { dryRun: true });
    expect(report.created).toEqual([]);
    const text = formatReport(report);
    expect(text).toContain('Row 2: ok, would create "Why octopuses have three hearts" (2026-11-02)');
    expect(text).toContain("Row 4: error in length: Length must be 30, 45 or 60 seconds.");
    expect(text).toContain('Row 8: skipped, Status is "Published"');
    expect(text.split("\n").at(-1)).toBe(
      "Dry run: 2 ready, 4 with errors, 1 skipped. Run again with --yes to create them (1 credit each).",
    );
  });

  it("creates one Short per valid row through the API", async () => {
    const sent: unknown[] = [];
    const client: ShortCreator = {
      createShort: async (body) => {
        sent.push(body);
        return {
          project_id: `prj_${sent.length}`,
          job_id: "j",
          status: "scripting",
          next: "",
          app_url: "https://app/p",
        };
      },
    };
    const report = await importCalendar(mapped, client, { dryRun: false });
    expect(sent).toEqual(mapped.planned.map((p) => p.input));
    expect(report.created).toEqual([
      { row: 2, date: "2026-11-02", project_id: "prj_1", app_url: "https://app/p" },
      { row: 9, date: "2026-11-08", project_id: "prj_2", app_url: "https://app/p" },
    ]);
    expect(formatReport(report)).toContain("Row 2: created prj_1 → https://app/p");
  });

  it("stops when credits run out and marks the rest as not created", async () => {
    const rows = rowsFromTable([["Topic"], ["Topic one"], ["Topic two"], ["Topic three"]]);
    let n = 0;
    const client: ShortCreator = {
      createShort: async () => {
        n++;
        if (n === 2) throw Object.assign(new Error("Not enough Short credits left."), { status: 400 });
        return { project_id: "prj_1", job_id: "j", status: "scripting", next: "" };
      },
    };
    const report = await importCalendar(mapCalendar(rows), client, { dryRun: false });
    expect(n).toBe(2);
    expect(report.errors).toEqual([
      { row: 3, message: "ShortLoop refused it: Not enough Short credits left." },
    ]);
    expect(report.skipped).toEqual([{ row: 4, reason: "not created: out of credits" }]);
  });
});

describe("reading calendars (fake network)", () => {
  it("reads a Google Sheet with unformatted values and the user's key", async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          values: [
            ["Topic", "Length", "Date"],
            ["Honey", 30, 46328],
          ],
        }),
      );
    }) as unknown as typeof globalThis.fetch;
    const rows = await readGoogleSheet({ spreadsheetId: "sheet1", apiKey: "k", fetch });
    expect(rows).toEqual([{ row: 2, values: { topic: "Honey", length: "30", date: "46328" } }]);
    const u = new URL(urls[0] ?? "");
    expect(u.pathname).toBe("/v4/spreadsheets/sheet1/values/A%3AZ");
    expect(u.searchParams.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
    expect(u.searchParams.get("key")).toBe("k");
    expect(mapCalendar(rows).planned[0]?.date).toBe("2026-11-02");
  });

  it("surfaces Google's error message and needs a credential", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "The caller does not have permission" } }), {
        status: 403,
      })) as unknown as typeof globalThis.fetch;
    await expect(readGoogleSheet({ spreadsheetId: "s", apiKey: "k", fetch })).rejects.toThrow(
      "Google Sheets: The caller does not have permission",
    );
    await expect(readGoogleSheet({ spreadsheetId: "s", fetch })).rejects.toThrow(/GOOGLE_SHEETS_API_KEY/);
  });

  it("reads every page of a Notion database", async () => {
    const bodies: { start_cursor?: string }[] = [];
    const page = (id: string, title: string): NotionPage => ({
      id,
      properties: { Topic: { type: "title", title: [{ plain_text: title }] } },
    });
    const fetch = (async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["notion-version"]).toBe("2022-06-28");
      const body = JSON.parse(String(init.body)) as { start_cursor?: string };
      bodies.push(body);
      return new Response(
        JSON.stringify(
          body.start_cursor
            ? { results: [page("p2", "Second topic")], has_more: false, next_cursor: null }
            : { results: [page("p1", "First topic")], has_more: true, next_cursor: "c2" },
        ),
      );
    }) as unknown as typeof globalThis.fetch;
    const rows = await readNotionDatabase({ databaseId: "db1", token: "secret_x", fetch });
    expect(rows.map((r) => [r.row, r.ref, r.values.topic])).toEqual([
      [1, "p1", "First topic"],
      [2, "p2", "Second topic"],
    ]);
    expect(bodies[1]?.start_cursor).toBe("c2");
  });
});
