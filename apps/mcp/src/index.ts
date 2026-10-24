/** @shortloop/mcp: ShortLoop's MCP server (tools only; the web app supplies the services and auth). */
export const PACKAGE_NAME = "@shortloop/mcp" as const;

export {
  buildShortLoopServer,
  createShortLoopMcpHandler,
  MAX_WAIT_SECONDS,
  TOOL_NAMES,
  type BuildOptions,
} from "./server";
export { ToolUserError, type ShortLoopServices } from "./services";
export * from "./schemas";
export { getWorkflow, listWorkflows } from "./playbooks";
