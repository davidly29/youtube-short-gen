/** @shortloop/worker: runs pipeline jobs. */
export const PACKAGE_NAME = "@shortloop/worker" as const;

export { createWorker, type WorkerDeps } from "./worker";
export { renderHandler, type RenderInput } from "./render";
