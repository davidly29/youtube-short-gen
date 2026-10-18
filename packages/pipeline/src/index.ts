/** @shortloop/pipeline: pipeline stages and the job service that runs them. */
export const PACKAGE_NAME = "@shortloop/pipeline" as const;

export * from "./jobs";
export { BullQueueDriver, RedisEventBus } from "./jobs-redis";
