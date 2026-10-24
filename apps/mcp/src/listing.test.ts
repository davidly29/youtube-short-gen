import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import {
  checkClaudeDirectory,
  checkCursor,
  checkOfficialRegistry,
  cursorDeeplink,
  registryServerJson,
  shortLoopListing,
  type ToolInfo,
} from "./listing";
import { createShortLoopMcpHandler } from "./server";
import type { ShortLoopServices } from "./services";
import { connectInProcess } from "./testing";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "listing");

/** tools/list never calls the services, so any call here is a bug. */
const noServices = new Proxy({} as ShortLoopServices, {
  get: (_t, name) =>
    name === "then"
      ? undefined
      : () => {
          throw new Error(`listing test called services.${String(name)}`);
        },
});

async function listedTools(): Promise<ToolInfo[]> {
  const handler = createShortLoopMcpHandler(() => noServices);
  const client = await connectInProcess(handler, { token: "t", clientId: "c", scopes: [] });
  const { tools } = await client.listTools();
  await client.close();
  return tools as ToolInfo[];
}

describe("MCP directory listings (E12-02)", () => {
  const listing = shortLoopListing();

  it("listing/server.json is generated from src/listing.ts and is current", async () => {
    const path = join(dir, "server.json");
    const expected = await format(JSON.stringify(registryServerJson(listing)), {
      ...(await resolveConfig(path)),
      filepath: path,
    });
    expect(readFileSync(path, "utf8"), "run pnpm -F mcp build:listing").toBe(expected);
  });

  it("passes the official MCP Registry's server.json rules", () => {
    const server = JSON.parse(readFileSync(join(dir, "server.json"), "utf8")) as Record<string, unknown>;
    expect(checkOfficialRegistry(server)).toEqual({
      directory: "MCP Registry (registry.modelcontextprotocol.io)",
      errors: [],
      ownerInputs: [],
    });
  });

  it("passes the Claude connectors directory checks for every tool the server lists", async () => {
    const tools = await listedTools();
    expect(tools.length).toBeGreaterThanOrEqual(12);
    const result = checkClaudeDirectory(listing, tools);
    expect(result.errors).toEqual([]);
    // Only the owner can supply these; the README lists them as the steps before submitting.
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    for (const input of result.ownerInputs) expect(readme).toContain(input);
    expect(
      checkClaudeDirectory(
        { ...listing, privacyPolicyUrl: "https://x.test/privacy", supportContact: "help" },
        tools,
      ),
    ).toMatchObject({ errors: [], ownerInputs: [] });
  });

  it("passes Cursor's deeplink format, and the README carries the same link", () => {
    const link = cursorDeeplink(listing);
    expect(checkCursor(listing, link).errors).toEqual([]);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(link);
  });

  it("the checkers reject broken listings", () => {
    const bad = registryServerJson({
      ...listing,
      name: "shortloop",
      description: "x".repeat(101),
      version: "^1.0.0",
      remoteUrl: "http://localhost:3000/api/mcp",
    });
    expect(checkOfficialRegistry({ ...bad, extra: 1 }).errors).toEqual([
      "name must be <reverse-dns namespace>/<server name>, 3-200 chars",
      "name must be in the io.github.davidly29/ namespace (GitHub sign-in proves it)",
      "description must be 1-100 chars",
      "version must be an exact version, not a range",
      "remote url http://localhost:3000/api/mcp must be https",
      "unknown field extra",
    ]);
    expect(
      checkClaudeDirectory(listing, [
        { name: "make short!", description: "short", inputSchema: {} },
        {
          name: "nuke",
          title: "Nuke",
          description: "Deletes everything, forever, for sure.",
          inputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: true },
        },
      ]).errors,
    ).toEqual([
      "make short!: name must match [a-zA-Z0-9_-]{1,64}",
      "make short!: needs a human-readable title",
      "make short!: needs a real description",
      "make short!: needs readOnlyHint: true or an explicit destructiveHint",
      "nuke: can't be read-only and destructive",
    ]);
    expect(
      checkCursor(listing, "cursor://anysphere.cursor-deeplink/mcp/install?name=x&config=e30=").errors,
    ).toEqual(["deeplink config.url must be the remote URL"]);
  });
});
