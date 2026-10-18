import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Job as JobSchema, type Job } from "@shortloop/contracts";
import { and, type Db, eq, schema, sum, toJob } from "@shortloop/db";

export type JobType = Job["type"];
type Status = Job["status"];

export const JOB_TYPES: readonly JobType[] = ["script", "voice", "visuals", "render", "publish", "trends"];
export const MAX_ATTEMPTS = 3;

/** Published on every status or progress change (Redis channel `job.updated` in production). */
export interface JobUpdated {
  jobId: string;
  type: JobType;
  status: Status;
  progress: number;
  error?: string;
}

export interface EventBus {
  publish(event: JobUpdated): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: JobUpdated) => void): () => void;
  close(): Promise<void>;
}

/** Runs a job id on a queue. `attempt` is 1-based. */
export type Processor = (jobId: string, attempt: number) => Promise<void>;

export interface QueueDriver {
  add(type: JobType, jobId: string): Promise<void>;
  process(type: JobType, processor: Processor): void;
  close(): Promise<void>;
}

export interface HandlerContext {
  job: Job;
  ownerId: string;
  onProgress: (progress: number) => Promise<void>;
}
export type JobHandler = (ctx: HandlerContext) => Promise<Record<string, unknown>>;

export interface EnqueueOptions {
  idempotencyKey: string;
  ownerId: string;
  costCredits?: number;
}

/**
 * Durable job state lives in Postgres (`jobs` table); the queue driver only carries job ids.
 * That makes enqueue idempotent (unique idempotency key) and keeps status readable without Redis.
 */
export type FinalFailureListener = (job: Job, ownerId: string) => Promise<void> | void;

export class JobService {
  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly failureListeners: FinalFailureListener[] = [];

  constructor(
    private readonly db: Db,
    private readonly driver: QueueDriver,
    private readonly bus: EventBus,
  ) {}

  /** Same idempotency key returns the existing job and never queues a second one. */
  async enqueue(type: JobType, input: Record<string, unknown>, opts: EnqueueOptions): Promise<Job> {
    const existing = await this.findByKey(opts.idempotencyKey);
    if (existing) return existing;
    const id = `job_${randomUUID()}`;
    const inserted = await this.db
      .insert(schema.jobs)
      .values({
        id,
        ownerId: opts.ownerId,
        type,
        input,
        idempotencyKey: opts.idempotencyKey,
        costCredits: opts.costCredits ?? 0,
      })
      .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
      .returning();
    const row = inserted[0];
    if (!row) {
      // Lost a race with a concurrent enqueue of the same key.
      const winner = await this.findByKey(opts.idempotencyKey);
      if (!winner) throw new Error(`job with key ${opts.idempotencyKey} vanished`);
      return winner;
    }
    await this.driver.add(type, id);
    const job = toJob(row);
    await this.emit(job);
    return job;
  }

  async get(jobId: string): Promise<Job | undefined> {
    const row = await this.db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
    return row ? toJob(row) : undefined;
  }

  /** Report progress (0..1) for a running job. Values are clamped and never go backwards. */
  async onProgress(jobId: string, progress: number): Promise<void> {
    const job = await this.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    const p = Math.min(1, Math.max(job.progress, progress));
    const [row] = await this.db
      .update(schema.jobs)
      .set({ progress: p, updatedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId))
      .returning();
    if (row) await this.emit(toJob(row));
  }

  register(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    this.driver.process(type, (jobId, attempt) => this.run(jobId, attempt));
  }

  subscribe(listener: (event: JobUpdated) => void): () => void {
    return this.bus.subscribe(listener);
  }

  /** Called once when a job has failed its last attempt (after the refund). */
  onFinalFailure(listener: FinalFailureListener): void {
    this.failureListeners.push(listener);
  }

  private async run(jobId: string, attempt: number): Promise<void> {
    const row = await this.db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
    if (!row) throw new Error(`unknown job ${jobId}`);
    if (row.status === "succeeded" || row.status === "cancelled") return;
    const handler = this.handlers.get(row.type);
    if (!handler) throw new Error(`no handler registered for ${row.type}`);
    await this.setStatus(jobId, "running", { error: null });
    try {
      const output = await handler({
        job: toJob({ ...row, status: "running" }),
        ownerId: row.ownerId,
        onProgress: (p) => this.onProgress(jobId, p),
      });
      await this.setStatus(jobId, "succeeded", { output, progress: 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_ATTEMPTS) {
        await this.setStatus(jobId, "failed", { error: message });
        await refundJob(this.db, jobId);
        const failed = await this.get(jobId);
        if (failed) for (const l of this.failureListeners) await l(failed, row.ownerId);
        return;
      }
      await this.setStatus(jobId, "queued", { error: message });
      throw err; // let the driver retry
    }
  }

  private async setStatus(
    jobId: string,
    status: Status,
    extra: { output?: Record<string, unknown>; error?: string | null; progress?: number },
  ): Promise<void> {
    const [row] = await this.db
      .update(schema.jobs)
      .set({ status, ...extra, updatedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId))
      .returning();
    if (row) await this.emit(toJob(row));
  }

  private async findByKey(key: string): Promise<Job | undefined> {
    const row = await this.db.query.jobs.findFirst({ where: eq(schema.jobs.idempotencyKey, key) });
    return row ? toJob(row) : undefined;
  }

  private async emit(job: Job): Promise<void> {
    JobSchema.parse(job);
    await this.bus.publish({
      jobId: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      ...(job.error ? { error: job.error } : {}),
    });
  }
}

/**
 * Give back whatever a job was charged: one `refund` row equal to minus the sum of its other
 * ledger rows, per unit. The ledger's unique (job_id, reason) index makes this idempotent.
 */
export async function refundJob(db: Db, jobId: string): Promise<void> {
  const charged = await db
    .select({
      ownerId: schema.creditLedger.ownerId,
      unit: schema.creditLedger.unit,
      total: sum(schema.creditLedger.delta),
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.jobId, jobId))
    .groupBy(schema.creditLedger.ownerId, schema.creditLedger.unit);
  for (const c of charged) {
    const total = Number(c.total ?? 0);
    if (total >= 0) continue;
    const already = await db.query.creditLedger.findFirst({
      where: and(eq(schema.creditLedger.jobId, jobId), eq(schema.creditLedger.reason, `refund:${c.unit}`)),
    });
    if (already) continue;
    await db
      .insert(schema.creditLedger)
      .values({ ownerId: c.ownerId, unit: c.unit, delta: -total, reason: `refund:${c.unit}`, jobId })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------- in-memory implementations

/** Process-local event bus for tests and single-process dev. */
export class MemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();
  async publish(event: JobUpdated): Promise<void> {
    this.emitter.emit("job.updated", event);
  }
  subscribe(listener: (event: JobUpdated) => void): () => void {
    this.emitter.on("job.updated", listener);
    return () => this.emitter.off("job.updated", listener);
  }
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

/** Runs jobs in-process, one at a time per type, retrying up to MAX_ATTEMPTS. */
export class MemoryQueueDriver implements QueueDriver {
  private readonly processors = new Map<JobType, Processor>();
  private readonly pending: { type: JobType; jobId: string }[] = [];
  private chain: Promise<void> = Promise.resolve();

  async add(type: JobType, jobId: string): Promise<void> {
    this.pending.push({ type, jobId });
    this.kick();
  }

  process(type: JobType, processor: Processor): void {
    this.processors.set(type, processor);
    this.kick();
  }

  /** Resolves when every queued job has finished (all attempts). */
  async drain(): Promise<void> {
    // Jobs can enqueue more jobs while running, so wait until the chain stops growing.
    for (;;) {
      this.kick();
      const current = this.chain;
      await current;
      if (current === this.chain && this.pending.length === 0) return;
    }
  }

  async close(): Promise<void> {
    await this.drain();
  }

  private kick(): void {
    const ready = this.pending.filter((p) => this.processors.has(p.type));
    for (const item of ready) {
      this.pending.splice(this.pending.indexOf(item), 1);
      const processor = this.processors.get(item.type);
      if (!processor) continue;
      this.chain = this.chain.then(async () => {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            await processor(item.jobId, attempt);
            return;
          } catch {
            // retried; JobService records the error and marks the last attempt failed
          }
        }
      });
    }
  }
}
