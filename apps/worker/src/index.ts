/** @shortloop/worker: runs pipeline jobs. */
export const PACKAGE_NAME = "@shortloop/worker" as const;

export { createWorker, type WorkerDeps, type WorkerProviders } from "./worker";
export { scriptHandler, PolicyBlockedError, type ScriptInput } from "./script";
export { narrationText, voiceHandler, type VoiceInput } from "./voice";
export { renderHandler, type RenderInput } from "./render";
export { visualsHandler, type VisualsInput } from "./visuals";
export { productionFailureListener, setProject, withProduction, type ProductionChain } from "./chain";
