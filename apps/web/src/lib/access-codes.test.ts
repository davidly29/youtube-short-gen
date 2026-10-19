import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_USES, matchAccessCode, parseAccessCodes, parseAdminEmails } from "./access-codes";

describe("beta access codes", () => {
  it("parses CODE:max lists, with a default limit, ignoring junk", () => {
    expect(parseAccessCodes("BETA123:3, OTHERCODE ,x:5,")).toEqual([
      { code: "BETA123", maxUses: 3 },
      { code: "OTHERCODE", maxUses: DEFAULT_MAX_USES },
    ]);
    expect(parseAccessCodes(undefined)).toEqual([]);
  });
  it("matches case-insensitively and ignores surrounding spaces", () => {
    const codes = parseAccessCodes("BetaCode9:2");
    expect(matchAccessCode("  betacode9 ", codes)?.code).toBe("BetaCode9");
    expect(matchAccessCode("betacode", codes)).toBeUndefined();
  });
  it("parses admin emails case-insensitively", () => {
    expect([...parseAdminEmails("Owner@Example.com, ,someone@x.io")]).toEqual([
      "owner@example.com",
      "someone@x.io",
    ]);
  });
});
