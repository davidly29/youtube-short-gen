import { AuditEvent } from "@shortloop/contracts";
import { eq, openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { explainPublish, recordAudit } from "./audit";
import { JobService, MemoryEventBus, MemoryQueueDriver, TRACEPARENT_KEY } from "./jobs";
import { currentTraceId, initTelemetry, withSpan, type Telemetry } from "./tracing";

const exporter = new InMemorySpanExporter();
let telemetry: Telemetry;
let h: DbHandle;

beforeAll(async () => {
  telemetry = await initTelemetry({
    serviceName: "audit-test",
    env: {},
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
});
afterAll(async () => {
  await telemetry.shutdown();
});
beforeEach(async () => {
  exporter.reset();
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
});
afterEach(async () => {
  await h.close();
});

const PUB = "pub_audit";

async function publishRecord(jobId?: string) {
  await h.db.insert(schema.channels).values({
    id: "ch_a",
    ownerId: SEED.userId,
    platform: "youtube",
    externalId: "UC_a",
    title: "A",
    secret: "sealed",
    status: "connected",
  });
  await h.db.insert(schema.publishRecords).values({
    id: PUB,
    ownerId: SEED.userId,
    platform: "youtube",
    channelId: "ch_a",
    videoAssetId: SEED.assetIds[0],
    projectId: SEED.projectId,
    request: {
      platform: "youtube",
      accountId: "ch_a",
      videoAssetId: SEED.assetIds[0],
      title: "t",
      description: "",
      tags: [],
      privacy: "public",
      aiDisclosure: false,
    },
    idempotencyKey: "k",
    jobId,
  });
}

describe("AuditEvent contract", () => {
  it("accepts a valid event and rejects an unknown type or a malformed trace id", () => {
    expect(AuditEvent.parse({ ownerId: "u", type: "approve", subjectId: "p" }).data).toEqual({});
    expect(AuditEvent.safeParse({ ownerId: "u", type: "deleted_everything" }).success).toBe(false);
    expect(AuditEvent.safeParse({ ownerId: "u", type: "approve", traceId: "abc" }).success).toBe(false);
    expect(AuditEvent.safeParse({ ownerId: "u", type: "approve", traceId: "0".repeat(32) }).success).toBe(
      false,
    );
  });
});

describe("recordAudit (E13-02)", () => {
  it("stores job id and the active span's trace id with the event", async () => {
    const traceId = await withSpan("t", {}, async () => {
      await recordAudit(h.db, {
        ownerId: SEED.userId,
        type: "approve",
        subjectId: SEED.projectId,
        jobId: "job_1",
      });
      return currentTraceId();
    });
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    const row = await h.db.query.auditEvents.findFirst({ where: eq(schema.auditEvents.type, "approve") });
    expect(row).toMatchObject({
      ownerId: SEED.userId,
      subjectId: SEED.projectId,
      data: { jobId: "job_1", traceId },
    });
  });

  it("refuses events that don't match the contract", async () => {
    await expect(
      recordAudit(h.db, { ownerId: SEED.userId, type: "nope" as "approve", subjectId: "x" }),
    ).rejects.toThrow();
  });

  it("audit_events stays append-only: update and delete both throw", async () => {
    await recordAudit(h.db, { ownerId: SEED.userId, type: "approve", subjectId: SEED.projectId });
    await expect(h.db.update(schema.auditEvents).set({ type: "publish.completed" })).rejects.toThrow();
    await expect(h.db.delete(schema.auditEvents)).rejects.toThrow();
    expect(await h.db.select().from(schema.auditEvents)).toHaveLength(1);
  });
});

describe("explainPublish", () => {
  it("joins approval, request and outcome into one explanation", async () => {
    await publishRecord("job_pub");
    await h.db.update(schema.projects).set({ scriptId: null }).where(eq(schema.projects.id, SEED.projectId));
    const entries = [
      {
        assetId: SEED.assetIds[0],
        kind: "image",
        source: "stock",
        licence: { type: "stock", provider: "pexels" },
        usedOn: ["video"],
      },
    ];
    await withSpan("publish.request", {}, async () => {
      await recordAudit(h.db, { ownerId: SEED.userId, type: "approve", subjectId: SEED.projectId });
      await recordAudit(h.db, {
        ownerId: SEED.userId,
        type: "publish.requested",
        subjectId: PUB,
        jobId: "job_pub",
      });
      await recordAudit(h.db, {
        ownerId: SEED.userId,
        type: "publish.completed",
        subjectId: PUB,
        jobId: "job_pub",
        data: { checks: { rights: "passed", variation: "passed" }, assets: entries },
      });
    });
    const x = await explainPublish(h.db, PUB);
    expect(x).toMatchObject({
      requestedBy: SEED.userId,
      jobId: "job_pub",
      assets: entries,
      checks: { rights: "passed", variation: "passed" },
    });
    expect(x.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(x.events.map((e) => e.type)).toEqual(["approve", "publish.requested", "publish.completed"]);
  });

  it("reports pending checks before the worker has run", async () => {
    await publishRecord();
    const x = await explainPublish(h.db, PUB);
    expect(x.checks).toEqual({ rights: "pending", variation: "pending" });
    await expect(explainPublish(h.db, "pub_missing")).rejects.toThrow(/unknown publish/);
  });
});

describe("trace context across the queue", () => {
  it("a job enqueued inside a span runs in a child span of the same trace, tagged with its job id", async () => {
    const driver = new MemoryQueueDriver();
    const jobs = new JobService(h.db, driver, new MemoryEventBus());
    let seen: string | undefined;
    jobs.register("script", async () => {
      seen = currentTraceId();
      return {};
    });
    const job = await withSpan("enqueue", {}, () =>
      jobs.enqueue("script", { topic: "x" }, { idempotencyKey: "trace-1", ownerId: SEED.userId }),
    );
    await driver.drain();
    expect(job.input[TRACEPARENT_KEY]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "enqueue");
    const child = spans.find((s) => s.name === "job.script");
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.attributes["shortloop.job_id"]).toBe(job.id);
    expect(seen).toBe(parent?.spanContext().traceId);
    await driver.close();
  });

  it("without an active span nothing is added to the job input", async () => {
    const jobs = new JobService(h.db, new MemoryQueueDriver(), new MemoryEventBus());
    const job = await jobs.enqueue(
      "script",
      { topic: "x" },
      { idempotencyKey: "trace-2", ownerId: SEED.userId },
    );
    expect(job.input).toEqual({ topic: "x" });
  });
});

describe("initTelemetry", () => {
  it("with no OTEL_EXPORTER_OTLP_ENDPOINT / SENTRY_DSN, exports nothing and makes no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // A second provider can't replace the registered one; this only checks what it would export.
    const t = await initTelemetry({ serviceName: "no-network", env: {} });
    expect(t.exporting).toEqual({ otlp: false, sentry: false });
    await withSpan("quiet", {}, async () => undefined);
    await t.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("turns on OTLP export only when the endpoint is set", async () => {
    const t = await initTelemetry({
      serviceName: "with-otlp",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" },
    });
    expect(t.exporting).toEqual({ otlp: true, sentry: false });
  });
});
