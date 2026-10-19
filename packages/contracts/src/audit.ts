import { z } from "zod";
import { Id } from "./common";

/**
 * Audit events that explain a publish (E13-02). The string values match what was already stored in
 * `audit_events.type`, so no data migration is needed. Other subsystems (keys, access codes, channels)
 * still write their own types directly.
 */
export const AuditEventType = z.enum([
  "asset.upload_attested",
  "variation_override",
  "approve",
  "publish.requested",
  "publish.completed",
  "publish.failed",
]);
export type AuditEventType = z.infer<typeof AuditEventType>;

/** W3C trace id: 32 lowercase hex characters, not all zero. */
export const TraceId = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .refine((s) => !/^0+$/.test(s), "invalid trace id");

export const AuditEvent = z.object({
  /** The user who did it. */
  ownerId: Id,
  type: AuditEventType,
  /** What it is about: an asset, script, project or publish record id. */
  subjectId: Id.optional(),
  /** The job that did the work, when there is one. */
  jobId: Id.optional(),
  /** The OpenTelemetry trace the event happened in (filled in by `recordAudit` when a span is active). */
  traceId: TraceId.optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
