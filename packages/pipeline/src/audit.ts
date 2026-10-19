import { AuditEvent, type AuditEventType } from "@shortloop/contracts";
import type { z } from "zod";
import { and, asc, eq, inArray, or, schema, type Db } from "@shortloop/db";
import type { RightsEntry } from "./rights";
import { currentTraceId } from "./tracing";

/**
 * Append-only audit trail (E13-02). `audit_events` has no `job_id`/`trace_id` columns, so both are kept
 * inside `data` (no schema change); the table's trigger rejects every update and delete.
 */
export async function recordAudit(db: Db, input: z.input<typeof AuditEvent>): Promise<void> {
  const event = AuditEvent.parse({ ...input, traceId: input.traceId ?? currentTraceId() });
  await db.insert(schema.auditEvents).values({
    ownerId: event.ownerId,
    type: event.type,
    subjectId: event.subjectId ?? null,
    data: {
      ...event.data,
      ...(event.jobId ? { jobId: event.jobId } : {}),
      ...(event.traceId ? { traceId: event.traceId } : {}),
    },
  });
}

type Row = typeof schema.auditEvents.$inferSelect;

/** Turn a stored row back into an `AuditEvent` (plus when it happened). */
function toEvent(row: Row): (AuditEvent & { at: string }) | undefined {
  const { jobId, traceId, ...data } = row.data;
  const parsed = AuditEvent.safeParse({
    ownerId: row.ownerId,
    type: row.type,
    subjectId: row.subjectId ?? undefined,
    jobId: typeof jobId === "string" ? jobId : undefined,
    traceId: typeof traceId === "string" ? traceId : undefined,
    data,
  });
  return parsed.success ? { ...parsed.data, at: row.createdAt } : undefined;
}

/** The checks a publish passed through, as recorded by the worker. */
export interface PublishChecks {
  rights: "passed" | "failed" | "pending";
  variation: "passed" | "overridden" | "failed" | "pending";
}

export interface PublishExplanation {
  publishId: string;
  /** User who asked for the publish. */
  requestedBy: string;
  jobId: string | undefined;
  traceId: string | undefined;
  status: string;
  /** Every asset in the published video, with its source and licence (the rights manifest). */
  assets: RightsEntry[];
  checks: PublishChecks;
  /** Approval, overrides and publish events, oldest first. */
  events: (AuditEvent & { at: string })[];
}

const PUBLISH_TYPES: AuditEventType[] = ["publish.requested", "publish.completed", "publish.failed"];

/** Who asked for a publish, which assets went out, which checks passed, and its job / trace ids. */
export async function explainPublish(db: Db, publishId: string): Promise<PublishExplanation> {
  const rec = await db.query.publishRecords.findFirst({ where: eq(schema.publishRecords.id, publishId) });
  if (!rec) throw new Error(`unknown publish ${publishId}`);
  const project = rec.projectId
    ? await db.query.projects.findFirst({ where: eq(schema.projects.id, rec.projectId) })
    : undefined;
  const related = [
    and(eq(schema.auditEvents.subjectId, publishId), inArray(schema.auditEvents.type, PUBLISH_TYPES)),
    ...(project
      ? [and(eq(schema.auditEvents.subjectId, project.id), eq(schema.auditEvents.type, "approve"))]
      : []),
    ...(project?.scriptId
      ? [
          and(
            eq(schema.auditEvents.subjectId, project.scriptId),
            eq(schema.auditEvents.type, "variation_override"),
          ),
        ]
      : []),
  ];
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.ownerId, rec.ownerId), or(...related)))
    .orderBy(asc(schema.auditEvents.id));
  const events = rows.map(toEvent).filter((e): e is AuditEvent & { at: string } => Boolean(e));

  const requested = events.findLast((e) => e.type === "publish.requested");
  // The worker's latest outcome for this record decides the checks and the assets.
  const outcome = events.findLast((e) => e.type === "publish.completed" || e.type === "publish.failed");
  const checks = (outcome?.data.checks ?? {}) as Partial<PublishChecks>;
  const assets = Array.isArray(outcome?.data.assets) ? (outcome.data.assets as RightsEntry[]) : [];
  return {
    publishId,
    requestedBy: requested?.ownerId ?? rec.ownerId,
    jobId: rec.jobId ?? requested?.jobId ?? outcome?.jobId,
    traceId: requested?.traceId ?? outcome?.traceId,
    status: rec.status,
    assets,
    checks: { rights: checks.rights ?? "pending", variation: checks.variation ?? "pending" },
    events,
  };
}
