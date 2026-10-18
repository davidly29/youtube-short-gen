import { z } from "zod";
import { Id } from "./common";

/** One BullMQ queue per pipeline stage (E0-04). */
export const JobType = z.enum(["script", "voice", "visuals", "render", "publish", "trends"]);
export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

export const Job = z.object({
  id: Id,
  type: JobType,
  status: JobStatus,
  progress: z.number().min(0).max(1),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  costCredits: z.number().nonnegative(),
  idempotencyKey: z.string().min(1),
});
export type Job = z.infer<typeof Job>;
