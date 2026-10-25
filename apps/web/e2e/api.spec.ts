import { expect, test, type APIRequestContext } from "@playwright/test";
import { addKey, signUp } from "./helpers";

type Json = Record<string, unknown>;

/** A tiny REST client, the way a developer's script would call ShortLoop. */
function client(request: APIRequestContext, key: string) {
  const headers = { authorization: `Bearer ${key}` };
  return {
    get: async (path: string, timeout = 15_000) => {
      const res = await request.get(`/api/v1${path}`, { headers, timeout });
      return { status: res.status(), body: (await res.json()) as Json, headers: res.headers() };
    },
    post: async (path: string, data: unknown = {}) => {
      const res = await request.post(`/api/v1${path}`, { headers, data });
      return { status: res.status(), body: (await res.json()) as Json };
    },
  };
}

async function waitDone(api: ReturnType<typeof client>, jobId: string) {
  let job = (await api.get(`/jobs/${jobId}?wait=50`, 70_000)).body;
  for (let i = 0; i < 3 && !job.done; i++) job = (await api.get(`/jobs/${jobId}?wait=50`, 70_000)).body;
  return job;
}

test.describe("E12-01 public REST API", () => {
  test("the spec is public; everything else needs a key", async ({ request }) => {
    const spec = await request.get("/api/v1/openapi.json");
    expect(spec.status()).toBe(200);
    expect(((await spec.json()) as Json).openapi).toBe("3.1.0");
    const res = await request.get("/api/v1/balance");
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  test("a developer creates a key and a webhook, then create -> wait -> approve -> publish over REST", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await signUp(page);
    await addKey(page, "gemini", "test-gemini-key-rest1");
    await page.goto("/channels");
    await page.getByTestId("connect-youtube").click();
    await expect(page.getByTestId("connected-banner")).toBeVisible();

    await page.goto("/settings/developer");
    await page.getByLabel("Key name").fill("My scheduler");
    await page.getByTestId("api-key-create").click();
    const key = (await page.getByTestId("api-key-new-value").textContent()) ?? "";
    expect(key).toMatch(/^sl_/);
    await expect(page.getByTestId("api-key-row")).toContainText("My scheduler");

    await page.getByLabel("Endpoint URL").fill("https://hooks.example.com/shortloop");
    await page.getByTestId("webhook-create").click();
    await expect(page.getByTestId("webhook-secret-value")).toContainText("whsec_");
    await expect(page.getByTestId("webhook-row")).toContainText("hooks.example.com");

    const api = client(request, key);
    const balance = await api.get("/balance");
    expect(balance.body).toMatchObject({ shorts: 5 });
    expect(balance.headers["x-ratelimit-limit"]).toBe("60");

    const created = await api.post("/shorts", {
      topic: "why octopuses have three hearts",
      length_seconds: 30,
    });
    expect(created.status).toBe(202);
    const projectId = String(created.body.project_id);
    const job = await waitDone(api, String(created.body.job_id));
    expect(job).toMatchObject({ done: true, status: "ready" });
    expect(job.video_url).toBeTruthy();

    const early = await api.post(`/shorts/${projectId}/publish`);
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toContain("Approve the Short before publishing");

    expect((await api.post(`/shorts/${projectId}/approve`)).body).toEqual({
      project_id: projectId,
      approved: true,
    });
    const pub = await api.post(`/shorts/${projectId}/publish`, { tags: ["octopus"] });
    expect(pub.status).toBe(202);
    const live = await waitDone(api, String(pub.body.job_id));
    expect(live).toMatchObject({ done: true, status: "published" });
    expect(String(live.url)).toContain("youtube.com/shorts/");

    // Webhooks fired for the render and the publish (fake sender in e2e: recorded, never sent).
    const hooks = (await api.get("/webhooks")).body.webhooks as { id: string }[];
    const hookId = hooks[0]?.id ?? "";
    await expect
      .poll(
        async () => {
          const d = (await api.get(`/webhooks/${hookId}/deliveries`)).body.deliveries as {
            event: string;
            status: string;
          }[];
          return d
            .filter((x) => x.status === "delivered")
            .map((x) => x.event)
            .sort();
        },
        { timeout: 30_000 },
      )
      .toEqual(["job.succeeded", "publish.completed"]);
    await page.goto("/settings/developer");
    await expect(page.getByTestId("webhook-deliveries")).toContainText("publish.completed");

    // The web app sees the same Short, published, and the credit was spent once.
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByTestId("publishes")).toContainText("Published");
    expect((await api.get("/balance")).body).toMatchObject({ shorts: 4 });

    // Revoking the key in Settings locks the API out at once.
    await page.goto("/settings/developer");
    await page.getByTestId("api-key-revoke").click();
    await expect(page.getByTestId("api-key-row")).toHaveCount(0);
    expect((await api.get("/balance")).status).toBe(401);
  });
});
