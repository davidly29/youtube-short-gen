import { CreateShortInput } from "@shortloop/mcp";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apiBase, zapierApp, type Bundle, type ZObject, type ZRequest, type ZResponse } from "./app";
import { checkZapier, type ZapierAppLike } from "./checklist";

// --- a fake Zapier runtime over a fake ShortLoop API ---------------------------------------------------------------

class ZError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
class ZThrottled extends Error {
  constructor(
    message: string,
    readonly delay?: number,
  ) {
    super(message);
  }
}

type Route = (req: ZRequest) => { status?: number; data: unknown; headers?: Record<string, string> };

function fakeZ(routes: Record<string, Route>) {
  const calls: ZRequest[] = [];
  const z: ZObject = {
    errors: { Error: ZError, ThrottledError: ZThrottled },
    async request(input) {
      // Zapier runs beforeRequest, sends, then afterResponse, like this.
      let req = { ...input };
      for (const mw of zapierApp.beforeRequest) req = mw(req, z, bundle);
      calls.push(req);
      const url = new URL(req.url);
      const key = `${req.method ?? "GET"} ${url.pathname.replace(/^\/api\/v1/, "")}`;
      const route = routes[key];
      if (!route) throw new Error(`no fake route for ${key}`);
      const r = route(req);
      let res: ZResponse = {
        status: r.status ?? 200,
        data: r.data,
        content: JSON.stringify(r.data),
        getHeader: (n) => r.headers?.[n.toLowerCase()],
      };
      for (const mw of zapierApp.afterResponse) res = mw(res, z);
      return res;
    },
  };
  const bundle: Bundle = {
    authData: { api_url: "https://app.example/", api_key: "sl_test_key" },
    inputData: {},
  };
  return { z, bundle, calls };
}

const short = (id: string) => ({
  project_id: id,
  title: "Octopus hearts",
  topic: "why octopuses have three hearts",
  status: "ready",
  app_url: `https://app.example/projects/${id}`,
  video_url: `https://media.example/${id}.mp4`,
  publishable: false,
  problems: ["Not approved yet"],
  script: {
    title: "t",
    hook: "Three hearts!",
    beats: [{ shot: 1, text: "Three hearts!", visual: "v" }],
    cta: "c",
  },
});

const trend = (id: string, already_made = false) => ({
  topic: `topic ${id}`,
  topic_id: id,
  angle: "angle",
  hook: "hook",
  format: "trend-explainer",
  why_now: "rising",
  sources: [{ title: "Source", url: "https://news.example/a" }],
  channel_id: "ch_1",
  channel_title: "Ocean Facts",
  already_made,
});

describe("Zapier app (E12-03)", () => {
  it("passes Zapier's review checklist (schema + publishing checks)", () => {
    const result = checkZapier(zapierApp);
    expect(result.errors).toEqual([]);
    expect(result.ownerInputs.length).toBeGreaterThan(0);
  });

  it("the checklist catches the mistakes Zapier's review rejects", () => {
    const rendered = zapierApp.triggers.short_rendered;
    const broken = {
      ...zapierApp,
      platformVersion: "1.0.0",
      triggers: {
        ...zapierApp.triggers,
        short_rendered: {
          ...rendered,
          display: { label: "short rendered", description: "Fires on render" },
          operation: { ...rendered.operation, performList: undefined },
        },
      },
    } as unknown as ZapierAppLike;
    const errors = checkZapier(broken).errors.join("\n");
    expect(errors).toMatch(/short_rendered label isn't Title Case/);
    expect(errors).toMatch(/short_rendered description should start with "Triggers when"/);
    expect(errors).toMatch(/short_rendered has no performList/);
    expect(errors).toMatch(/versions: platformVersion/);
  });

  it("normalises the app URL to the API base", () => {
    expect(apiBase({ api_url: "https://app.example" })).toBe("https://app.example/api/v1");
    expect(apiBase({ api_url: "https://app.example/api/v1/" })).toBe("https://app.example/api/v1");
    expect(() => apiBase({})).toThrow(/app URL/);
  });

  it("tests the connection with GET /account and the user's key", async () => {
    const { z, bundle, calls } = fakeZ({
      "GET /account": () => ({ data: { name: "Dee", plan: "creator" } }),
    });
    await expect(zapierApp.authentication.test(z, bundle)).resolves.toMatchObject({ name: "Dee" });
    expect(calls[0]?.url).toBe("https://app.example/api/v1/account");
    expect(calls[0]?.headers?.authorization).toBe("Bearer sl_test_key");
  });

  it("explains a rejected key and turns 429 into a throttle", async () => {
    const { z, bundle } = fakeZ({
      "GET /account": () => ({ status: 401, data: { error: { code: "unauthorized", message: "bad key" } } }),
      "POST /shorts": () => ({
        status: 429,
        data: { error: { code: "rate_limited", message: "Slow down" } },
        headers: { "retry-after": "12" },
      }),
    });
    await expect(zapierApp.authentication.test(z, bundle)).rejects.toThrow(/Settings → Developer/);
    bundle.inputData = { topic: "octopus hearts" };
    const err = await zapierApp.creates.create_short.operation.perform(z, bundle).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZThrottled);
    expect((err as ZThrottled).delay).toBe(12);
  });

  it("Short Rendered subscribes a job.succeeded webhook and unsubscribes it", async () => {
    let created: unknown;
    const { z, bundle, calls } = fakeZ({
      "POST /webhooks": (req) => {
        created = req.body;
        return { status: 201, data: { id: "wh_1", secret: "whsec_x" } };
      },
      "DELETE /webhooks/wh_1": () => ({ data: { id: "wh_1", deleted: true } }),
    });
    bundle.targetUrl = "https://hooks.zapier.com/hooks/standard/1/abc";
    const op = zapierApp.triggers.short_rendered.operation;
    const sub = await op.performSubscribe(z, bundle);
    expect(created).toEqual({ url: bundle.targetUrl, events: ["job.succeeded"] });
    bundle.subscribeData = sub;
    await op.performUnsubscribe(z, bundle);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /api/v1/webhooks",
      "DELETE /api/v1/webhooks/wh_1",
    ]);
  });

  it("Short Rendered reads the Short back for a production event and ignores the rest", async () => {
    const { z, bundle } = fakeZ({ "GET /shorts/prj_1": () => ({ data: short("prj_1") }) });
    const op = zapierApp.triggers.short_rendered.operation;
    bundle.cleanedRequest = {
      id: "evt_1",
      type: "job.succeeded",
      data: { job_id: "job_1", kind: "production", project_id: "prj_1", status: "ready" },
    };
    const [rec] = await op.perform(z, bundle);
    expect(rec).toMatchObject({
      id: "prj_1",
      title: "Octopus hearts",
      hook: "Three hearts!",
      problems: "Not approved yet",
      job_id: "job_1",
      event_id: "evt_1",
    });
    // Same fields as the static sample, so Zaps built on the sample keep working live.
    expect(Object.keys(rec ?? {}).sort()).toEqual(Object.keys(op.sample).sort());

    bundle.cleanedRequest = { type: "job.failed", data: { kind: "production", project_id: "prj_1" } };
    await expect(op.perform(z, bundle)).resolves.toEqual([]);
    bundle.cleanedRequest = { type: "job.succeeded", data: { kind: "publish", project_id: "prj_1" } };
    await expect(op.perform(z, bundle)).resolves.toEqual([]);
  });

  it("Short Rendered's test list returns recent ready Shorts in the live shape", async () => {
    const { z, bundle, calls } = fakeZ({
      "GET /shorts": () => ({ data: { shorts: [{ project_id: "prj_1" }, { project_id: "prj_2" }] } }),
      "GET /shorts/prj_1": () => ({ data: short("prj_1") }),
      "GET /shorts/prj_2": () => ({ data: short("prj_2") }),
    });
    const list = await zapierApp.triggers.short_rendered.operation.performList(z, bundle);
    expect(list.map((r) => r.id)).toEqual(["prj_1", "prj_2"]);
    expect(calls[0]?.params).toEqual({ status: "ready", limit: "3" });
  });

  it("New Brief Idea returns unmade ideas with unique ids and passes filters", async () => {
    const { z, bundle, calls } = fakeZ({
      "GET /trends": () => ({
        data: { available: true, trends: [trend("top_a"), trend("top_b", true), trend("top_c")] },
      }),
    });
    bundle.inputData = { niche: " history ", channel_id: "" };
    const ideas = await zapierApp.triggers.new_brief_idea.operation.perform(z, bundle);
    expect(ideas.map((i) => i.id)).toEqual(["top_a", "top_c"]);
    expect(ideas[0]?.sources).toBe("Source (https://news.example/a)");
    expect(calls[0]?.params).toEqual({ niche: "history" });
    expect(Object.keys(ideas[0] ?? {}).sort()).toEqual(
      Object.keys(zapierApp.triggers.new_brief_idea.operation.sample).sort(),
    );
  });

  it("New Brief Idea is empty (not an error) when there is no brief yet", async () => {
    const { z, bundle } = fakeZ({
      "GET /trends": () => ({ data: { available: false, message: "Pick a niche" } }),
    });
    await expect(zapierApp.triggers.new_brief_idea.operation.perform(z, bundle)).resolves.toEqual([]);
  });

  it("Create Short sends a body the API accepts", async () => {
    let sent: unknown;
    const { z, bundle } = fakeZ({
      "POST /shorts": (req) => {
        sent = req.body;
        return {
          status: 202,
          data: { project_id: "prj_9", job_id: "job_9", status: "scripting", next: "wait" },
        };
      },
    });
    // What a Zap sends: strings everywhere, empty optional fields.
    bundle.inputData = {
      topic: "why octopuses have three hearts",
      angle: "",
      length_seconds: "30",
      caption_style: "karaoke",
      voice_id: "",
      topic_id: "top_abc",
    };
    const out = await zapierApp.creates.create_short.operation.perform(z, bundle);
    expect(sent).toEqual({
      topic: "why octopuses have three hearts",
      length_seconds: 30,
      caption_style: "karaoke",
      topic_id: "top_abc",
    });
    expect(CreateShortInput.safeParse(sent).success).toBe(true);
    expect(out).toMatchObject({ id: "prj_9", job_id: "job_9", app_url: "" });
  });

  it("dropdown triggers list voices and channels", async () => {
    const { z, bundle } = fakeZ({
      "GET /voices": () => ({ data: { voices: [{ id: "v1", label: "Aria", language: "en-US" }] } }),
      "GET /account": () => ({
        data: { channels: [{ channel_id: "ch_1", title: "Ocean", platform: "youtube" }] },
      }),
    });
    await expect(zapierApp.triggers.voice.operation.perform(z, bundle)).resolves.toEqual([
      { id: "v1", label: "Aria (en-US)" },
    ]);
    await expect(zapierApp.triggers.channel.operation.perform(z, bundle)).resolves.toEqual([
      { id: "ch_1", label: "Ocean (youtube)" },
    ]);
  });

  it("bundles into a self-contained CommonJS app Zapier can load", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const res = await build({
      entryPoints: [join(root, "src", "zapier", "entry.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      logLevel: "silent",
    });
    const code = res.outputFiles[0]?.text ?? "";
    expect(code).not.toMatch(/require\(["'](@shortloop|zod)/);
    const mod = { exports: {} as unknown };
    new Function("module", "exports", "require", code)(mod, mod.exports, () => {
      throw new Error("the Zapier bundle must not require anything");
    });
    const loaded = mod.exports as typeof zapierApp;
    expect(Object.keys(loaded.triggers)).toEqual(Object.keys(zapierApp.triggers));
    expect(checkZapier(loaded).errors).toEqual([]);
  });
});
