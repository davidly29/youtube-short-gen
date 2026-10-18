import { describe, expect, it } from "vitest";
import { appName } from "./app-info";

describe("web app", () => {
  it("has a name", () => {
    expect(appName).toBe("ShortLoop");
  });
});
