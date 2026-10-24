/**
 * Public MCP directory listings (E12-02): one source of listing facts, the files each directory takes, and the
 * checks each directory runs, so a listing can't be submitted broken.
 *
 * Directories: the official MCP Registry (server.json, which PulseMCP, Glama and others mirror), the Claude
 * connectors directory, and Cursor (install deeplink). Submitting is an owner step: see apps/mcp/listing/README.md.
 */

export interface Listing {
  /** Reverse-DNS registry name. `io.github.<owner>/…` is proven by signing in to the registry with GitHub. */
  name: string;
  title: string;
  /** ≤ 100 characters (registry limit). */
  description: string;
  version: string;
  /** The public Streamable HTTP endpoint. */
  remoteUrl: string;
  websiteUrl: string;
  repositoryUrl: string;
  docsUrl: string;
  auth: "oauth2.1";
  /** Owner inputs: a listing can't go live without them (Claude directory requires both). */
  privacyPolicyUrl?: string;
  supportContact?: string;
}

/** Staging until a production domain exists (see the README). Override with SHORTLOOP_PUBLIC_URL when building. */
export const STAGING_ORIGIN = "https://web-staging-0f0b5.up.railway.app";

export function shortLoopListing(origin = STAGING_ORIGIN): Listing {
  const o = origin.replace(/\/+$/, "");
  return {
    name: "io.github.davidly29/shortloop",
    title: "ShortLoop",
    description: "Make original YouTube Shorts from a topic: script, voice, visuals, captions, then publish.",
    version: "1.0.0",
    remoteUrl: `${o}/api/mcp`,
    websiteUrl: o,
    repositoryUrl: "https://github.com/davidly29/youtube-short-gen",
    docsUrl: "https://github.com/davidly29/youtube-short-gen/blob/master/docs/setup/mcp.md",
    auth: "oauth2.1",
  };
}

// ------------------------------------------------------------------ files

export const REGISTRY_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json";

/** apps/mcp/listing/server.json for `mcp-publisher publish` (official MCP Registry). */
export function registryServerJson(l: Listing): Record<string, unknown> {
  return {
    $schema: REGISTRY_SCHEMA_URL,
    name: l.name,
    title: l.title,
    description: l.description,
    version: l.version,
    websiteUrl: l.websiteUrl,
    repository: { url: l.repositoryUrl, source: "github", subfolder: "apps/mcp" },
    remotes: [{ type: "streamable-http", url: l.remoteUrl }],
  };
}

/** Cursor's one-click install link (`cursor://…/mcp/install?name=…&config=<base64 JSON>`). */
export function cursorDeeplink(l: Listing): string {
  const config = Buffer.from(JSON.stringify({ url: l.remoteUrl })).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=shortloop&config=${encodeURIComponent(config)}`;
}

// ------------------------------------------------------------------ checks

export interface CheckResult {
  directory: string;
  /** Things this repo must fix. A listing with errors must not be submitted. */
  errors: string[];
  /** Facts only the owner can supply (legal pages, contacts). Listed in apps/mcp/listing/README.md. */
  ownerInputs: string[];
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}

const isHttpsUrl = (u: unknown): boolean => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
};

/**
 * Rules of the registry's server.schema.json (2025-09-29) that apply to a remote-only server, plus the registry's
 * publish-time checks (no version ranges, namespace matches the GitHub owner).
 */
export function checkOfficialRegistry(
  server: Record<string, unknown>,
  githubOwner = "davidly29",
): CheckResult {
  const errors: string[] = [];
  const str = (k: string) => (typeof server[k] === "string" ? (server[k] as string) : undefined);
  if (server.$schema !== REGISTRY_SCHEMA_URL) errors.push(`$schema must be ${REGISTRY_SCHEMA_URL}`);
  const name = str("name") ?? "";
  if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(name) || name.length < 3 || name.length > 200) {
    errors.push("name must be <reverse-dns namespace>/<server name>, 3-200 chars");
  }
  if (!name.startsWith(`io.github.${githubOwner}/`)) {
    errors.push(`name must be in the io.github.${githubOwner}/ namespace (GitHub sign-in proves it)`);
  }
  const description = str("description") ?? "";
  if (description.length < 1 || description.length > 100) errors.push("description must be 1-100 chars");
  const title = str("title");
  if (title !== undefined && (title.length < 1 || title.length > 100))
    errors.push("title must be 1-100 chars");
  const version = str("version") ?? "";
  if (!version || version.length > 255) errors.push("version is required (≤ 255 chars)");
  if (/[\^~<>*]|\bx\b|latest|\|\|/i.test(version) || /\s/.test(version)) {
    errors.push("version must be an exact version, not a range");
  }
  if (server.websiteUrl !== undefined && !isHttpsUrl(server.websiteUrl))
    errors.push("websiteUrl must be https");
  const repo = server.repository as { url?: string; source?: string } | undefined;
  if (repo && (!isHttpsUrl(repo.url) || !repo.source))
    errors.push("repository needs an https url and a source");
  const remotes = server.remotes as { type?: string; url?: string }[] | undefined;
  const packages = server.packages as unknown[] | undefined;
  if (!remotes?.length && !packages?.length) errors.push("needs at least one remote or package");
  for (const r of remotes ?? []) {
    if (r.type !== "streamable-http" && r.type !== "sse")
      errors.push(`remote type ${r.type} is not supported`);
    if (!isHttpsUrl(r.url)) errors.push(`remote url ${r.url} must be https`);
  }
  const known = new Set([
    "$schema",
    "name",
    "title",
    "description",
    "version",
    "websiteUrl",
    "repository",
    "remotes",
    "packages",
    "icons",
    "_meta",
  ]);
  for (const k of Object.keys(server)) if (!known.has(k)) errors.push(`unknown field ${k}`);
  return { directory: "MCP Registry (registry.modelcontextprotocol.io)", errors, ownerInputs: [] };
}

/**
 * The Claude connectors directory's review requirements that can be checked from code: remote over HTTPS with
 * OAuth, and every tool with a clear name, title, description and safety annotation (readOnlyHint or
 * destructiveHint), so clients can tell reads from writes.
 */
export function checkClaudeDirectory(l: Listing, tools: ToolInfo[]): CheckResult {
  const errors: string[] = [];
  const ownerInputs: string[] = [];
  if (!isHttpsUrl(l.remoteUrl)) errors.push("remote URL must be https");
  if (l.auth !== "oauth2.1") errors.push("remote servers must use OAuth 2.1 (no shared API keys)");
  if (!isHttpsUrl(l.docsUrl)) errors.push("needs public setup docs (https)");
  if (!l.privacyPolicyUrl) ownerInputs.push("privacy policy URL");
  else if (!isHttpsUrl(l.privacyPolicyUrl)) errors.push("privacy policy URL must be https");
  if (!l.supportContact) ownerInputs.push("support contact (email or URL)");
  if (tools.length === 0) errors.push("server lists no tools");
  const seen = new Set<string>();
  for (const t of tools) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) errors.push(`${t.name}: name must match [a-zA-Z0-9_-]{1,64}`);
    if (seen.has(t.name)) errors.push(`${t.name}: duplicate tool name`);
    seen.add(t.name);
    if (!t.title?.trim()) errors.push(`${t.name}: needs a human-readable title`);
    if (!t.description || t.description.trim().length < 20)
      errors.push(`${t.name}: needs a real description`);
    if (!t.inputSchema) errors.push(`${t.name}: needs an input schema`);
    const a = t.annotations ?? {};
    if (a.readOnlyHint !== true && typeof a.destructiveHint !== "boolean") {
      errors.push(`${t.name}: needs readOnlyHint: true or an explicit destructiveHint`);
    }
    if (a.readOnlyHint === true && a.destructiveHint === true) {
      errors.push(`${t.name}: can't be read-only and destructive`);
    }
  }
  return { directory: "Claude connectors directory", errors, ownerInputs };
}

/** Cursor installs from the deeplink; it must decode to the same https endpoint. */
export function checkCursor(l: Listing, deeplink: string): CheckResult {
  const errors: string[] = [];
  const url = new URL(deeplink);
  if (
    url.protocol !== "cursor:" ||
    url.host !== "anysphere.cursor-deeplink" ||
    url.pathname !== "/mcp/install"
  ) {
    errors.push("deeplink must be cursor://anysphere.cursor-deeplink/mcp/install");
  }
  if (!url.searchParams.get("name")) errors.push("deeplink needs a name");
  try {
    const config = JSON.parse(
      Buffer.from(url.searchParams.get("config") ?? "", "base64").toString("utf8"),
    ) as {
      url?: string;
    };
    if (config.url !== l.remoteUrl) errors.push("deeplink config.url must be the remote URL");
  } catch {
    errors.push("deeplink config must be base64 JSON");
  }
  if (!isHttpsUrl(l.remoteUrl)) errors.push("remote URL must be https");
  return { directory: "Cursor", errors, ownerInputs: [] };
}
