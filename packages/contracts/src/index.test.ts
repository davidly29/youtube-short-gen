import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@shortloop/contracts", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@shortloop/contracts");
  });
});
