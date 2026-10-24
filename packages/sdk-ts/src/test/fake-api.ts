/**
 * An in-memory ShortLoop API behind a `fetch` function (no sockets, no network), with the same rules as the real
 * one: bearer keys, approval before publish, one credit per Short, 429 with Retry-After. Every exchange is recorded
 * so the tests can check each request and response against docs/api/openapi.yaml.
 */

export interface Exchange {
  method: string;
  path: string;
  query: Record<string, string>;
  requestBody: unknown;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface Project {
  id: string;
  status: "producing" | "ready" | "approved";
  polls: number;
  failed: boolean;
}

export interface FakeApiOptions {
  key?: string;
  /** Answer the next N requests with 429. */
  rateLimitNext?: number;
  /** Production jobs whose topic contains this fail. */
  failTopic?: string;
  credits?: number;
}

export function createFakeApi(opts: FakeApiOptions = {}) {
  const key = opts.key ?? "sl_test_key";
  const exchanges: Exchange[] = [];
  const projects = new Map<string, Project>();
  const publishes = new Map<string, { project: string; privacy: string; polls: number }>();
  let credits = opts.credits ?? 5;
  let rateLimitNext = opts.rateLimitNext ?? 0;
  let seq = 0;

  const rl = { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59", "x-ratelimit-reset": "1798000000" };
  const err = (status: number, code: string, message: string, headers: Record<string, string> = {}) => ({
    status,
    headers,
    body: { error: { code, message } },
  });
  const ok = (status: number, body: unknown) => ({ status, headers: rl, body });

  function productionView(p: Project) {
    if (p.status === "producing") {
      p.polls += 1;
      if (p.polls >= 2) p.status = "ready";
    }
    if (p.failed) {
      return {
        job_id: `job_${p.id}`,
        kind: "production",
        project_id: p.id,
        status: "failed",
        progress: 1,
        done: true,
        error: "Render failed (fake). Your credit was refunded.",
      };
    }
    const done = p.status !== "producing";
    return {
      job_id: `job_${p.id}`,
      kind: "production",
      project_id: p.id,
      status: p.status,
      ...(done ? {} : { stage: "render" }),
      progress: done ? 1 : 0.6,
      done,
      ...(done ? { video_url: `https://files.test/${p.id}.mp4`, publishable: true, problems: [] } : {}),
    };
  }

  function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>) {
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/balance")
      return ok(200, { shorts: credits, ai_video_credits: 0, plan: "free" });
    if (method === "GET" && path === "/voices") {
      return ok(200, {
        voices: [
          {
            id: "edge:en-US-AriaNeural",
            label: "Aria",
            language: "en-US",
            provider: "edge",
            commercial_use: true,
          },
        ],
      });
    }
    if (method === "GET" && path === "/caption-styles") {
      return ok(200, { styles: [{ id: "bold-pop", label: "Bold pop", description: "Big words that pop." }] });
    }
    if (method === "POST" && path === "/estimate") {
      return ok(200, {
        shorts: 1,
        ai_video_credits: 0,
        balance: { shorts: credits, ai_video_credits: 0, plan: "free" },
        affordable: credits >= 1,
        note: "1 Short credit.",
      });
    }
    if (method === "GET" && path === "/trends") {
      return ok(200, {
        available: true,
        message: "Today's brief",
        trends: [{ topic: "octopus hearts", why_now: "spiking" }],
      });
    }
    if (method === "POST" && path === "/shorts") {
      if (typeof body.topic !== "string" || body.topic.length < 3) {
        return err(400, "invalid_request", "topic: must be at least 3 characters");
      }
      if (credits < 1) return err(400, "invalid_request", "No Short credits left.");
      credits -= 1;
      const id = `prj_${++seq}`;
      const failed = !!opts.failTopic && body.topic.includes(opts.failTopic);
      if (failed) credits += 1;
      projects.set(id, { id, status: "producing", polls: 0, failed });
      return ok(202, {
        project_id: id,
        job_id: `job_${id}`,
        status: "producing",
        next: "GET /jobs/{job_id}?wait=50",
      });
    }
    if ((m = path.match(/^\/shorts\/([^/]+)\/approve$/)) && method === "POST") {
      const p = projects.get(decodeURIComponent(m[1] ?? ""));
      if (!p) return err(404, "not_found", "No such Short");
      if (p.status === "producing")
        return err(400, "invalid_request", "Wait for the render to finish first.");
      p.status = "approved";
      return ok(200, { project_id: p.id, approved: true });
    }
    if ((m = path.match(/^\/shorts\/([^/]+)\/publish$/)) && method === "POST") {
      const p = projects.get(decodeURIComponent(m[1] ?? ""));
      if (!p) return err(404, "not_found", "No such Short");
      if (p.status !== "approved")
        return err(400, "invalid_request", "Approve the Short before publishing it.");
      const id = `pub_${++seq}`;
      publishes.set(id, { project: p.id, privacy: String(body.privacy ?? "public"), polls: 0 });
      return ok(202, {
        publish_id: id,
        job_id: `pubjob_${id}`,
        status: "queued",
        next: "GET /jobs/{job_id}?wait=50",
      });
    }
    if ((m = path.match(/^\/jobs\/([^/]+)$/)) && method === "GET") {
      const id = decodeURIComponent(m[1] ?? "");
      const wait = Number(query.get("wait") ?? 0);
      if (!Number.isInteger(wait) || wait < 0 || wait > 50) return err(400, "invalid_request", "wait: 0..50");
      if (id.startsWith("pubjob_")) {
        const pub = publishes.get(id.slice("pubjob_".length));
        if (!pub) return err(404, "not_found", "No such job");
        pub.polls += 1;
        const done = pub.polls >= 2;
        return ok(200, {
          job_id: id,
          kind: "publish",
          project_id: pub.project,
          status: done ? "published" : "uploading",
          progress: done ? 1 : 0.5,
          done,
          ...(done ? { url: "https://www.youtube.com/shorts/fake123" } : {}),
        });
      }
      const p = projects.get(id.replace(/^job_/, ""));
      if (!p) return err(404, "not_found", "No such job");
      return ok(200, productionView(p));
    }
    if (method === "GET" && path === "/workflows") {
      return ok(200, {
        workflows: [{ slug: "myth-vs-fact", title: "Myth vs fact", summary: "Bust one myth." }],
      });
    }
    if ((m = path.match(/^\/workflows\/([^/]+)\/([^/]+)$/)) && method === "GET") {
      return ok(200, {
        slug: decodeURIComponent(m[1] ?? ""),
        phase: decodeURIComponent(m[2] ?? ""),
        markdown: "# Start\n",
      });
    }
    return err(404, "not_found", "No such endpoint");
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const requestBody: unknown = raw ? JSON.parse(raw) : undefined;
    const auth = new Headers(init?.headers).get("authorization");
    let res: { status: number; headers: Record<string, string>; body: unknown };
    if (rateLimitNext > 0) {
      rateLimitNext -= 1;
      res = err(429, "rate_limited", "Slow down.", { "retry-after": "1" });
    } else if (auth !== `Bearer ${key}`) {
      res = err(401, "unauthorized", "Missing, unknown or revoked API key.");
    } else {
      res = route(method, path, url.searchParams, (requestBody ?? {}) as Record<string, unknown>);
    }
    exchanges.push({
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      requestBody,
      status: res.status,
      headers: res.headers,
      body: res.body,
    });
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json", ...res.headers },
    });
  };

  return { fetch: fetchImpl as typeof fetch, exchanges, key, credits: () => credits };
}
