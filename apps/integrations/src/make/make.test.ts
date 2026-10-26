import { CreateShortInput } from "@shortloop/mcp";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, type MakeApp, type MakeModule } from "./app";
import { checkMake } from "./checklist";
import { makeFiles } from "./files";
import { render } from "./iml";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "make");
const mod = (name: string): MakeModule => {
  const m = makeApp.modules.find((x) => x.name === name);
  if (!m) throw new Error(name);
  return m;
};
const connection = { apiUrl: "https://app.example/api/v1", apiKey: "sl_test_key" };

/** What Make would send for a module call: base URL + headers from Base, the rest from the module. */
function request(communication: Record<string, unknown>, scope: Record<string, unknown>) {
  const base = render(makeApp.base, { connection }) as { baseUrl: string; headers: Record<string, string> };
  const c = render(communication, { connection, ...scope }) as {
    url: string;
    method?: string;
    qs?: Record<string, unknown>;
    body?: unknown;
  };
  return { ...c, url: c.url.startsWith("/") ? base.baseUrl + c.url : c.url, headers: base.headers };
}

describe("Make app (E12-03)", () => {
  it("apps/integrations/make is generated from src/make/app.ts and is current", async () => {
    for (const [name, content] of Object.entries(await makeFiles(dir)))
      expect(readFileSync(join(dir, name), "utf8"), `run pnpm -F integrations build:make (${name})`).toBe(
        content,
      );
  });

  it("passes Make's app review checklist", () => {
    const result = checkMake(makeApp);
    expect(result.errors).toEqual([]);
    expect(result.ownerInputs.length).toBeGreaterThan(0);
  });

  it("the checklist catches the mistakes Make's review rejects", () => {
    const watch = mod("watchBriefIdeas");
    const broken: MakeApp = {
      ...makeApp,
      base: { ...makeApp.base, log: {} },
      rpcs: makeApp.rpcs.filter((r) => r.name !== "listVoices"),
      modules: [
        ...makeApp.modules.filter((m) => m.name !== "watchBriefIdeas"),
        {
          ...watch,
          label: "New brief ideas",
          parameters: watch.parameters.filter((p) => p.name !== "limit"),
          communication: { url: "/trends?x={{parameters.nope}}&y={{formatDate(now; 'YYYY')}}" },
        },
      ],
    };
    const errors = checkMake(broken).errors.join("\n");
    expect(errors).toMatch(/base: authorization header isn't sanitized/);
    expect(errors).toMatch(/watchBriefIdeas label isn't Title Case/);
    expect(errors).toMatch(/watchBriefIdeas trigger label should start "Watch"/);
    expect(errors).toMatch(/watchBriefIdeas has no Limit parameter/);
    expect(errors).toMatch(/reads parameters.nope, which isn't defined/);
    expect(errors).toMatch(/unsupported \{\{formatDate/);
    expect(errors).toMatch(/uses missing rpc:\/\/listVoices/);
  });

  it("the connection is checked with GET /account and labelled with the account name", () => {
    const c = render(makeApp.connection.communication, { parameters: connection }) as {
      url: string;
      headers: Record<string, string>;
    };
    expect(c.url).toBe("https://app.example/api/v1/account");
    expect(c.headers.authorization).toBe("Bearer sl_test_key");
    const meta = render(makeApp.connection.communication.response, { body: { name: "Dee" } }) as {
      metadata: { value: string };
    };
    expect(meta.metadata.value).toBe("Dee");
  });

  it("errors show the API's message", () => {
    const err = render(makeApp.base.response, {
      statusCode: 400,
      body: { error: { code: "invalid_request", message: "Topic is too short" } },
    }) as { error: { message: string } };
    expect(err.error.message).toBe("[400] Topic is too short");
  });

  it("Create a Short sends a body the API accepts", () => {
    // Make passes only the fields the user filled in; selects carry their option values.
    const parameters = {
      topic: "why octopuses have three hearts",
      length_seconds: 30,
      caption_style: "boxed",
    };
    const req = request(mod("createShort").communication, { parameters });
    expect(req).toMatchObject({ url: "https://app.example/api/v1/shorts", method: "POST", body: parameters });
    expect(req.headers.authorization).toBe("Bearer sl_test_key");
    expect(CreateShortInput.safeParse(req.body).success).toBe(true);
    for (const p of mod("createShort").expect)
      for (const o of Array.isArray(p.options) ? p.options : [])
        expect(
          CreateShortInput.safeParse({ topic: "abc", [p.name]: o.value }).success,
          `${p.name}=${o.value}`,
        ).toBe(true);
  });

  it("Watch Brief Ideas polls /trends without the limit, skips made ideas and dedupes on topic_id", () => {
    const m = mod("watchBriefIdeas");
    const req = request(m.communication, { parameters: { limit: 5, niche: "history" } });
    expect(req.url).toBe("https://app.example/api/v1/trends");
    expect(req.qs).toEqual({ niche: "history" });
    const response = (
      m.communication as { response: { iterate: { condition: string }; trigger: { id: string } } }
    ).response;
    const ideas = [
      { topic_id: "top_a", already_made: false },
      { topic_id: "top_b", already_made: true },
    ];
    const kept = ideas.filter((item) => render(response.iterate.condition, { item }));
    expect(kept.map((i) => render(response.trigger.id, { item: i }))).toEqual(["top_a"]);
  });

  it("the Short rendered webhook attaches for job.succeeded and detaches by id", () => {
    const [hook] = makeApp.webhooks;
    expect(hook).toBeDefined();
    if (!hook) return;
    const webhook = { url: "https://hook.eu1.make.com/abc", externalHookId: "wh_1" };
    const attach = request(hook.attach, { webhook });
    expect(attach).toMatchObject({
      url: "https://app.example/api/v1/webhooks",
      method: "POST",
      body: { url: webhook.url, events: ["job.succeeded"] },
    });
    expect(render(hook.attach.response, { body: { id: "wh_1" } })).toEqual({
      data: { externalHookId: "wh_1" },
    });
    expect(request(hook.detach, { webhook })).toMatchObject({
      url: "https://app.example/api/v1/webhooks/wh_1",
      method: "DELETE",
    });
    const event = {
      id: "evt_1",
      type: "job.succeeded",
      data: { project_id: "prj_1", job_id: "job_1", kind: "production", status: "ready" },
    };
    expect(render(mod("watchShortRendered").communication.output, { body: event })).toEqual(event.data);
  });

  it("Get a Short reads /shorts/{project_id}", () => {
    expect(request(mod("getShort").communication, { parameters: { project_id: "prj_1" } }).url).toBe(
      "https://app.example/api/v1/shorts/prj_1",
    );
  });

  it("dropdown RPCs map voices and channels to options", () => {
    const voices = makeApp.rpcs.find((r) => r.name === "listVoices")?.communication.response as {
      output: Record<string, string>;
    };
    expect(render(voices.output, { item: { id: "v1", label: "Aria" } })).toEqual({
      label: "Aria",
      value: "v1",
    });
  });
});
