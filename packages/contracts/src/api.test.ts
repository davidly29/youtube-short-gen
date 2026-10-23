import { describe, expect, it } from "vitest";
import { ApiError, CreatePublicApiKey, CreateWebhook, WEBHOOK_EVENTS, WebhookPayload, WebhookUrl } from "./api";

describe("public API contracts (E12-01)", () => {
  it("webhook URLs must be public https", () => {
    expect(WebhookUrl.safeParse("https://hooks.example.com/shortloop").success).toBe(true);
    for (const bad of [
      "http://hooks.example.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.0.4/x",
      "https://172.20.0.1/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://user:pw@hooks.example.com/x",
      "https://db.internal/x",
      "not a url",
    ]) {
      expect(WebhookUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("a new webhook subscribes to every event by default", () => {
    const w = CreateWebhook.parse({ url: "https://hooks.example.com/a" });
    expect(w.events).toEqual([...WEBHOOK_EVENTS]);
    expect(CreateWebhook.safeParse({ url: "https://hooks.example.com/a", events: [] }).success).toBe(false);
    expect(CreateWebhook.safeParse({ url: "https://hooks.example.com/a", events: ["job.nope"] }).success).toBe(
      false,
    );
  });

  it("key names are required and short", () => {
    expect(CreatePublicApiKey.parse({ name: "  Zapier  " }).name).toBe("Zapier");
    expect(CreatePublicApiKey.safeParse({ name: " " }).success).toBe(false);
    expect(CreatePublicApiKey.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("payloads and errors have a fixed shape", () => {
    const valid = {
      id: "evt_1",
      type: "job.succeeded",
      created_at: "2026-10-23T10:00:00.000Z",
      data: { job_id: "job_1", kind: "production", project_id: "prj_1", status: "ready" },
    };
    expect(WebhookPayload.safeParse(valid).success).toBe(true);
    expect(WebhookPayload.safeParse({ ...valid, type: "job.started" }).success).toBe(false);
    expect(ApiError.safeParse({ error: { code: "rate_limited", message: "Slow down." } }).success).toBe(true);
    expect(ApiError.safeParse({ error: { code: "teapot", message: "x" } }).success).toBe(false);
  });
});
