import { WEBHOOK_MAX_ATTEMPTS, WebhookPayload } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { FakeWebhookSender, SecretBox, verifyWebhookSignature } from "@shortloop/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectWebhookEvents, deliverDueWebhooks, dispatchWebhooks, webhookAad } from "./webhooks";

let h: DbHandle;
const box = new SecretBox("pipeline-webhooks-test-key-123");
const SECRET = "whsec_test_secret_for_pipeline";
const T0 = new Date("2026-10-23T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
});
afterEach(async () => {
  await h.close();
});

async function hook(id: string, url: string, events: string[], createdAt = T0) {
  await h.db.insert(schema.webhooks).values({
    id,
    ownerId: SEED.userId,
    url,
    events,
    secret: box.seal(SECRET, webhookAad(SEED.userId, id)),
    createdAt: createdAt.toISOString(),
  });
}

async function job(
  id: string,
  type: "render" | "voice" | "publish",
  status: "succeeded" | "failed",
  when: Date,
) {
  await h.db.insert(schema.jobs).values({
    id,
    ownerId: SEED.userId,
    type,
    status,
    error: status === "failed" ? "Voice provider refused the key" : null,
    input: { chain: { projectId: SEED.projectId } },
    idempotencyKey: id,
    updatedAt: when.toISOString(),
  });
}

describe("webhook events (E12-01)", () => {
  it("turns finished renders, failures and publishes into signed deliveries, once each", async () => {
    await hook("wh_all", "https://hooks.example.com/all", [
      "job.succeeded",
      "job.failed",
      "publish.completed",
    ]);
    await hook("wh_pub", "https://hooks.example.com/pub", ["publish.completed"]);
    await job("job_old", "render", "succeeded", at(-60_000)); // before the webhooks existed
    await job("job_render", "render", "succeeded", at(1000));
    await job("job_voice", "voice", "failed", at(2000));
    await job("job_pub", "publish", "succeeded", at(3000));
    await h.db.insert(schema.channels).values({
      id: "ch_1",
      ownerId: SEED.userId,
      platform: "youtube",
      externalId: "UC1",
      title: "Octo",
      secret: "x",
      status: "connected",
    });
    await h.db.insert(schema.publishRecords).values({
      id: "pub_1",
      ownerId: SEED.userId,
      platform: "youtube",
      channelId: "ch_1",
      videoAssetId: SEED.assetIds[0],
      request: {
        platform: "youtube",
        accountId: "ch_1",
        videoAssetId: SEED.assetIds[0],
        title: "t",
        description: "",
        tags: [],
        privacy: "public",
        aiDisclosure: false,
      },
      status: "published",
      url: "https://youtube.com/shorts/abc",
      idempotencyKey: "pub_1",
      projectId: SEED.projectId,
      jobId: "job_pub",
      updatedAt: at(3000).toISOString(),
    });

    const sender = new FakeWebhookSender();
    const r1 = await dispatchWebhooks({ db: h.db, sender, box, now: () => at(5000) });
    expect(r1).toEqual({ queued: 4, delivered: 4, retrying: 0, failed: 0 });
    // Running again (or on a second instance) finds nothing new.
    expect(await dispatchWebhooks({ db: h.db, sender, box, now: () => at(6000) })).toEqual({
      queued: 0,
      delivered: 0,
      retrying: 0,
      failed: 0,
    });

    const byUrl = (u: string) => sender.sent.filter((s) => s.url.endsWith(u));
    const all = byUrl("/all").map((s) => WebhookPayload.parse(JSON.parse(s.body)));
    expect(all.map((p) => p.type).sort()).toEqual(["job.failed", "job.succeeded", "publish.completed"]);
    expect(all.find((p) => p.type === "job.succeeded")?.data).toEqual({
      job_id: "job_render",
      kind: "production",
      project_id: SEED.projectId,
      status: "ready",
    });
    expect(all.find((p) => p.type === "job.failed")?.data).toMatchObject({
      job_id: "job_voice",
      error: "Voice provider refused the key",
    });
    expect(all.find((p) => p.type === "publish.completed")?.data).toMatchObject({
      publish_id: "pub_1",
      job_id: "job_pub",
      platform: "youtube",
      status: "published",
      url: "https://youtube.com/shorts/abc",
    });
    const pub = byUrl("/pub");
    expect(pub).toHaveLength(1);
    // Same event, same id, whichever webhook gets it.
    expect(JSON.parse(pub[0]?.body ?? "{}").id).toBe(all.find((p) => p.type === "publish.completed")?.id);

    for (const s of sender.sent) {
      expect(s.headers["content-type"]).toBe("application/json");
      expect(s.headers["shortloop-event"]).toMatch(/^(job|publish)\./);
      const sig = s.headers["shortloop-signature"] ?? "";
      expect(verifyWebhookSignature(SECRET, s.body, sig, Math.floor(at(5000).getTime() / 1000))).toBe(true);
    }
  });

  it("retries failures with backoff and gives up after the last attempt", async () => {
    await hook("wh_bad", "https://hooks.example.com/fail", ["job.succeeded"]);
    await job("job_r", "render", "succeeded", at(1000));
    const sender = new FakeWebhookSender();
    expect(await collectWebhookEvents(h.db, at(2000))).toBe(1);

    let now = at(2000);
    const deps = { db: h.db, sender, box, now: () => now };
    expect(await deliverDueWebhooks(deps)).toEqual({ delivered: 0, retrying: 1, failed: 0 });
    // Not due again until the first backoff (1 min) has passed.
    now = at(2000 + 30_000);
    expect(await deliverDueWebhooks(deps)).toEqual({ delivered: 0, retrying: 0, failed: 0 });
    let row = await h.db.query.webhookDeliveries.findFirst();
    expect(row).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500 });
    expect(row?.error).toContain("500");

    for (let i = 2; i <= WEBHOOK_MAX_ATTEMPTS; i++) {
      now = new Date(new Date(row?.nextAttemptAt ?? 0).getTime() + 1);
      await deliverDueWebhooks(deps);
      row = await h.db.query.webhookDeliveries.findFirst();
    }
    expect(row).toMatchObject({ status: "failed", attempts: WEBHOOK_MAX_ATTEMPTS });
    expect(sender.sent).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
  });

  it("skips disabled webhooks and fails deliveries whose webhook was disabled", async () => {
    await hook("wh_1", "https://hooks.example.com/1", ["job.succeeded"]);
    await job("job_r", "render", "succeeded", at(1000));
    expect(await collectWebhookEvents(h.db, at(2000))).toBe(1);
    await h.db
      .update(schema.webhooks)
      .set({ disabledAt: at(2500).toISOString() })
      .where(eq(schema.webhooks.id, "wh_1"));
    await job("job_r2", "render", "succeeded", at(2600));
    const sender = new FakeWebhookSender();
    expect(await dispatchWebhooks({ db: h.db, sender, box, now: () => at(3000) })).toEqual({
      queued: 0,
      delivered: 0,
      retrying: 0,
      failed: 1,
    });
    expect(sender.sent).toHaveLength(0);
  });

  it("ignores events older than a day", async () => {
    await hook("wh_1", "https://hooks.example.com/1", ["job.succeeded"], at(-3 * 86_400_000));
    await job("job_old", "render", "succeeded", at(-2 * 86_400_000));
    await job("job_new", "render", "succeeded", at(-1000));
    expect(await collectWebhookEvents(h.db, T0)).toBe(1);
  });
});
