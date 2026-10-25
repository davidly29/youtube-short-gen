import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addKey, signUp } from "./helpers";

const BASE = "http://localhost:3100";
const REDIRECT = "http://127.0.0.1:3999/callback";

/** What an MCP client (Claude, Cursor, ...) keeps between steps of the OAuth dance. */
class AgentOAuth implements OAuthClientProvider {
  authUrl?: URL;
  private verifier = "";
  private info?: Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
  private tok?: Awaited<ReturnType<OAuthClientProvider["tokens"]>>;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return {
      client_name: "E2E Agent",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(i: NonNullable<typeof this.info>) {
    this.info = i;
  }
  tokens() {
    return this.tok;
  }
  saveTokens(t: NonNullable<typeof this.tok>) {
    this.tok = t;
  }
  redirectToAuthorization(u: URL) {
    this.authUrl = u;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** Connect an MCP client the way a real agent does: 401 -> discover -> register -> browser consent -> token. */
async function connectAgent(page: Page) {
  const oauth = new AgentOAuth();
  const url = new URL("/api/mcp", BASE);
  const first = new StreamableHTTPClientTransport(url, { authProvider: oauth });
  await expect(new Client({ name: "e2e-agent", version: "1.0.0" }).connect(first)).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(oauth.authUrl?.toString()).toContain("/api/auth/oauth2/authorize");

  await page.route("http://127.0.0.1:3999/**", (r) => r.fulfill({ body: "You can close this tab." }));
  await page.goto(String(oauth.authUrl));
  await expect(page.getByTestId("consent")).toBeVisible();
  const callback = page.waitForRequest((r) => r.url().startsWith(REDIRECT));
  await page.getByTestId("consent-allow").click();
  const params = new URL((await callback).url()).searchParams;
  expect(params.get("code")).toBeTruthy();
  expect(params.get("iss")).toBe(`${BASE}/api/auth`); // RFC 9207 mix-up protection
  await first.finishAuth(params);

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: oauth }));
  return client;
}

const data = <T = Record<string, unknown>>(r: unknown): T => {
  const x = r as { isError?: boolean; structuredContent?: T; content?: { text?: string }[] };
  if (x.isError) throw new Error(x.content?.[0]?.text ?? "tool error");
  return x.structuredContent as T;
};

test.describe("E9-01 MCP server", () => {
  test("unauthenticated requests get a 401 pointing at the OAuth metadata", async ({ request }) => {
    const res = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("resource_metadata=");
    const meta = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(meta.resource).toBe(`${BASE}/api/mcp`);
    const as = await (await request.get("/.well-known/oauth-authorization-server/api/auth")).json();
    expect(as.registration_endpoint).toContain("/oauth2/register");
  });

  test("an agent signs in with OAuth, then create -> wait -> approve -> publish", async ({ page }) => {
    test.setTimeout(240_000);
    await signUp(page);
    await addKey(page, "gemini", "test-gemini-key-mcp1");
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();

    const agent = await connectAgent(page);
    const { tools } = await agent.listTools();
    expect(tools).toHaveLength(23);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_workflows", "get_workflow", "get_account", "get_short", "list_shorts"]),
    );
    const account = data<{ ai_scripts: boolean; channels: { title: string }[] }>(
      await agent.callTool({ name: "get_account", arguments: {} }),
    );
    expect(account.ai_scripts).toBe(true);
    expect(account.channels.map((c) => c.title)).toEqual(["Fake Channel"]);

    const balance = data<{ shorts: number }>(
      await agent.callTool({ name: "get_credit_balance", arguments: {} }),
    );
    expect(balance.shorts).toBe(5);

    // MCP-03: the agent uploads the user's own image (attested), then uses it in the Short.
    const png = join(mkdtempSync(join(tmpdir(), "mcp-up-")), "octopus reef.png");
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=540x960",
      "-frames:v",
      "1",
      png,
    ]);
    const bytes = readFileSync(png);
    const up = data<{ upload_url: string; upload_key: string; headers: Record<string, string> }>(
      await agent.callTool({
        name: "create_upload",
        arguments: { filename: "octopus reef.png", size_bytes: bytes.length, i_own_this_media: true },
      }),
    );
    expect(up.upload_url.startsWith(BASE)).toBe(true);
    const put = await fetch(up.upload_url, { method: "PUT", headers: up.headers, body: bytes });
    expect(put.status).toBe(200);
    const asset = data<{ asset_id: string; kind: string; preview_url: string }>(
      await agent.callTool({
        name: "finish_upload",
        arguments: { upload_key: up.upload_key, filename: "octopus reef.png", i_own_this_media: true },
      }),
    );
    expect(asset).toMatchObject({ kind: "image", preview_url: expect.stringMatching(/^http/) });
    const lib = data<{ assets: { asset_id: string }[] }>(
      await agent.callTool({ name: "list_library", arguments: {} }),
    );
    expect(lib.assets.map((a) => a.asset_id)).toEqual([asset.asset_id]);

    const created = data<{ job_id: string; project_id: string }>(
      await agent.callTool({
        name: "create_short",
        arguments: {
          topic: "why octopuses have three hearts",
          length_seconds: 30,
          library_asset_ids: [asset.asset_id],
        },
      }),
    );
    let job = data<{ done: boolean; status: string; video_url?: string }>(
      await agent.callTool(
        { name: "wait_for_job", arguments: { job_id: created.job_id } },
        { timeout: 70_000 },
      ),
    );
    for (let i = 0; i < 3 && !job.done; i++) {
      job = data(
        await agent.callTool(
          { name: "wait_for_job", arguments: { job_id: created.job_id } },
          { timeout: 70_000 },
        ),
      );
    }
    expect(job).toMatchObject({ done: true, status: "ready" });
    expect(job.video_url).toMatch(/^http/); // absolute, so the agent (and the in-chat preview) can open it

    // MCP v2: the agent can inspect the Short (script, captions, app link) and find it again later.
    const detail = data<{ script?: { beats: unknown[] }; captions?: unknown[]; app_url: string }>(
      await agent.callTool({ name: "get_short", arguments: { project_id: created.project_id } }),
    );
    expect(detail.script?.beats.length).toBeGreaterThan(1);
    expect(detail.captions?.length).toBeGreaterThan(0);
    expect(detail.app_url).toBe(`${BASE}/projects/${created.project_id}`);
    const listed = data<{ shorts: { project_id: string }[] }>(
      await agent.callTool({ name: "list_shorts", arguments: { status: "ready" } }),
    );
    expect(listed.shorts.map((x) => x.project_id)).toContain(created.project_id);

    // Publishing before approval is refused (E9-01 acceptance).
    const early = (await agent.callTool({
      name: "publish_short",
      arguments: { project_id: created.project_id },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(early.isError).toBe(true);
    expect(early.content[0]?.text).toContain("Approve the Short before publishing");

    data(await agent.callTool({ name: "approve_short", arguments: { project_id: created.project_id } }));
    const pub = data<{ job_id: string }>(
      await agent.callTool({
        name: "publish_short",
        arguments: { project_id: created.project_id, tags: ["octopus"] },
      }),
    );
    const live = data<{ status: string; url?: string; done: boolean }>(
      await agent.callTool({ name: "wait_for_job", arguments: { job_id: pub.job_id } }, { timeout: 70_000 }),
    );
    expect(live).toMatchObject({
      done: true,
      status: "published",
      url: expect.stringContaining("youtube.com/shorts/"),
    });

    // The web app sees the same Short, published.
    await page.goto(`/projects/${created.project_id}`);
    await expect(page.getByTestId("publishes")).toContainText("Published");
    expect(
      data<{ shorts: number }>(await agent.callTool({ name: "get_credit_balance", arguments: {} })).shorts,
    ).toBe(4);
  });

  test("signing in during the OAuth flow continues to consent", async ({ page, browser }) => {
    const email = await signUp(page);
    const fresh = await browser.newPage();
    const oauth = new AgentOAuth();
    const t = new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { authProvider: oauth });
    await expect(new Client({ name: "a", version: "1" }).connect(t)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await fresh.goto(String(oauth.authUrl));
    await expect(fresh).toHaveURL(/\/sign-in/);
    await fresh.getByLabel("Email").fill(email);
    await fresh.getByLabel("Password").fill("correct-horse-battery");
    await fresh.getByRole("button", { name: "Sign in" }).click();
    await expect(fresh.getByTestId("consent")).toBeVisible();
    await expect(fresh.getByTestId("consent-client")).toContainText("E2E Agent");
    await fresh.close();
  });
});
