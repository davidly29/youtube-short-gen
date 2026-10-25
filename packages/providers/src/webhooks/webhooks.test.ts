import { describe, expect, it } from "vitest";
import {
  FakeWebhookSender,
  HttpWebhookSender,
  isPrivateAddress,
  newWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
} from "./index";

describe("webhook signing (E12-01)", () => {
  const secret = newWebhookSecret();
  const body = JSON.stringify({ id: "evt_1", type: "job.succeeded" });

  it("verifies its own signatures and rejects tampering, wrong secrets and stale timestamps", () => {
    expect(secret).toMatch(/^whsec_[\w-]{43}$/);
    const header = signWebhook(secret, body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, header, 1_800_000_010)).toBe(true);
    expect(verifyWebhookSignature(secret, body + " ", header, 1_800_000_010)).toBe(false);
    expect(verifyWebhookSignature(newWebhookSecret(), body, header, 1_800_000_010)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, 1_800_000_000 + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, body, "garbage", 1_800_000_000)).toBe(false);
  });
});

describe("HttpWebhookSender", () => {
  it("classifies private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses hosts that resolve to private addresses without connecting", async () => {
    let called = false;
    const sender = new HttpWebhookSender({
      resolve: async () => ["10.0.0.7"],
      fetch: (async () => {
        called = true;
        return new Response(null);
      }) as typeof fetch,
    });
    const res = await sender.send({ url: "https://rebind.example.com/x", body: "{}", headers: {} });
    expect(res.error).toContain("private");
    expect(called).toBe(false);
  });

  it("posts to public hosts without following redirects and reports the status", async () => {
    const seen: RequestInit[] = [];
    const sender = new HttpWebhookSender({
      resolve: async () => ["93.184.216.34"],
      fetch: (async (_u: URL, init: RequestInit) => {
        seen.push(init);
        return new Response("moved", { status: 302 });
      }) as unknown as typeof fetch,
    });
    const res = await sender.send({ url: "https://hooks.example.com/x", body: "{}", headers: { a: "b" } });
    expect(res).toEqual({ status: 302 });
    expect(seen[0]).toMatchObject({ method: "POST", redirect: "manual", body: "{}" });
  });

  it("reports timeouts and connection errors as errors", async () => {
    const sender = new HttpWebhookSender({
      resolve: async () => ["93.184.216.34"],
      fetch: (async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      }) as typeof fetch,
    });
    expect(
      (await sender.send({ url: "https://hooks.example.com/x", body: "{}", headers: {} })).error,
    ).toContain("Timed out");
    expect(
      (await sender.send({ url: "http://hooks.example.com/x", body: "{}", headers: {} })).error,
    ).toContain("https");
  });

  it("the fake records and fails on demand", async () => {
    const f = new FakeWebhookSender();
    expect(await f.send({ url: "https://ok.example.com", body: "{}", headers: {} })).toEqual({ status: 200 });
    expect(await f.send({ url: "https://ok.example.com/fail", body: "{}", headers: {} })).toEqual({
      status: 500,
    });
    expect(f.sent).toHaveLength(2);
  });
});
