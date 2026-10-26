import { CaptionStyleId } from "@shortloop/contracts";
import { CreateShortInput } from "@shortloop/mcp";
import { describe, expect, it } from "vitest";
import { CAPTION_CHOICES, CREATE_SHORT_FIELDS, parseLength, toCreateShortBody } from "./fields";

describe("shared Create Short fields", () => {
  it("every field is a field of the public API's POST /shorts body", () => {
    const shape = Object.keys(CreateShortInput.shape);
    for (const f of CREATE_SHORT_FIELDS) expect(shape).toContain(f.key);
  });

  it("caption choices are exactly the app's caption presets", () => {
    expect(CAPTION_CHOICES.map((c) => c.value).sort()).toEqual([...CaptionStyleId.options].sort());
  });

  it("defaults and choices are values the API accepts", () => {
    const body = toCreateShortBody({
      topic: "why octopuses have three hearts",
      ...Object.fromEntries(CREATE_SHORT_FIELDS.filter((f) => f.default).map((f) => [f.key, f.default])),
    });
    expect(CreateShortInput.safeParse(body).success).toBe(true);
    for (const f of CREATE_SHORT_FIELDS.filter((x) => x.choices))
      for (const c of f.choices ?? [])
        expect(
          CreateShortInput.safeParse(toCreateShortBody({ topic: "abc", [f.key]: c.value })).success,
        ).toBe(true);
  });

  it("drops empty values and reads lengths the way people type them", () => {
    expect(toCreateShortBody({ topic: " x y z ", angle: "", tone: "   ", length_seconds: "60s" })).toEqual({
      topic: "x y z",
      length_seconds: 60,
    });
    expect(["45", "45 sec", "45 seconds", "0:45"].map(parseLength)).toEqual([45, 45, 45, 45]);
    expect(parseLength("long")).toBeNaN();
  });
});
