import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@shortloop/ui", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@shortloop/ui");
  });
});
