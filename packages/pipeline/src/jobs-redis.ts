import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  MAX_ATTEMPTS,
  type EventBus,
  type JobType,
  type JobUpdated,
  type Processor,
  type QueueDriver,
} from "./jobs";

const CHANNEL = "job.updated";

/** BullMQ driver: one queue per pipeline stage, exponential backoff, MAX_ATTEMPTS attempts. */
export class BullQueueDriver implements QueueDriver {
  private readonly queues = new Map<JobType, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    private readonly redisUrl: string,
    private readonly concurrency: Partial<Record<JobType, number>> = {},
  ) {}

  private connection() {
    return new Redis(this.redisUrl, { maxRetriesPerRequest: null });
  }

  private queue(type: JobType): Queue {
    let q = this.queues.get(type);
    if (!q) {
      q = new Queue(type, { connection: this.connection() });
      this.queues.set(type, q);
    }
    return q;
  }

  async add(type: JobType, jobId: string): Promise<void> {
    await this.queue(type).add(
      type,
      { jobId },
      {
        jobId,
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  process(type: JobType, processor: Processor): void {
    const worker = new Worker<{ jobId: string }>(
      type,
      async (job) => processor(job.data.jobId, job.attemptsMade + 1),
      { connection: this.connection(), concurrency: this.concurrency[type] ?? 1 },
    );
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

/** Redis pub/sub event bus so the web app can stream progress from workers. */
export class RedisEventBus implements EventBus {
  private readonly pub: Redis;
  private sub: Redis | undefined;
  private readonly listeners = new Set<(e: JobUpdated) => void>();

  constructor(private readonly redisUrl: string) {
    this.pub = new Redis(redisUrl);
  }

  async publish(event: JobUpdated): Promise<void> {
    await this.pub.publish(CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: (event: JobUpdated) => void): () => void {
    if (!this.sub) {
      this.sub = new Redis(this.redisUrl);
      void this.sub.subscribe(CHANNEL);
      this.sub.on("message", (_channel: string, message: string) => {
        const event = JSON.parse(message) as JobUpdated;
        for (const l of this.listeners) l(event);
      });
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.pub.quit();
    await this.sub?.quit();
  }
}
