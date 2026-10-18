import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@shortloop/mcp", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@shortloop/mcp");
  });
});
