import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  ApproveOutput,
  Balance,
  CaptionStyle,
  CreateShortInput,
  CreateShortOutput,
  EstimateInput,
  EstimateOutput,
  JobView,
  PublishInput,
  PublishOutput,
  SwapVisualInput,
  TrendsInput,
  TrendsOutput,
  Voice,
} from "./schemas";
import { ToolUserError, type ShortLoopServices } from "./services";

export const MAX_WAIT_SECONDS = 50;

const INSTRUCTIONS = `ShortLoop makes original 9:16 YouTube Shorts and publishes them to the user's channel.
Typical flow: create_short (topic -> job) -> wait_for_job until done -> show the user the video_url ->
optionally swap_visual -> approve_short (only after the user has seen it) -> publish_short -> wait_for_job.
Each Short uses one credit (get_credit_balance, estimate_cost). Never publish without the user's explicit OK.`;

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: Record<string, unknown>): Result {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/** User-facing problems become tool errors the agent can relay; anything else is logged and kept generic. */
async function run(
  fn: () => Promise<Record<string, unknown>>,
  onError?: (e: unknown) => void,
): Promise<Result> {
  try {
    return ok(await fn());
  } catch (e) {
    const known = e instanceof ToolUserError || (e instanceof Error && e.name === "ToolUserError");
    if (!known) onError?.(e);
    const message = known
      ? (e as Error).message
      : "Something went wrong on ShortLoop's side. Try again in a moment.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BuildOptions {
  /** Poll interval for wait_for_job. */
  pollMs?: number;
  onError?: (e: unknown) => void;
}

/** One McpServer bound to one user's services. Tools only translate; all logic lives in the services. */
export function buildShortLoopServer(services: ShortLoopServices, opts: BuildOptions = {}): McpServer {
  const server = new McpServer({ name: "shortloop", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const pollMs = opts.pollMs ?? 1000;
  const r = (fn: () => Promise<Record<string, unknown>>) => run(fn, opts.onError);

  server.registerTool(
    "get_trends",
    {
      title: "Trending topics",
      description:
        "Rising topics for a niche, as starting points for Shorts. (The trend radar launches in Q2; until then it says so.)",
      inputSchema: TrendsInput,
      outputSchema: TrendsOutput,
      annotations: { readOnlyHint: true },
    },
    (input) => r(() => services.getTrends(input)),
  );

  server.registerTool(
    "create_short",
    {
      title: "Create a Short",
      description:
        "Start making an original Short from a topic: script (written by the user's AI key, or the `script` you pass), voiceover, visuals, captions and render. Uses 1 credit. Returns a job_id for wait_for_job.",
      inputSchema: CreateShortInput,
      outputSchema: CreateShortOutput,
    },
    (input) => r(() => services.createShort(input)),
  );

  server.registerTool(
    "get_job",
    {
      title: "Job status",
      description:
        "Status of a production or publish job: stage, progress, errors, and the video or YouTube link when done.",
      inputSchema: z.object({ job_id: z.string() }),
      outputSchema: JobView,
      annotations: { readOnlyHint: true },
    },
    ({ job_id }) => r(() => services.getJob(job_id)),
  );

  server.registerTool(
    "wait_for_job",
    {
      title: "Wait for a job",
      description: `Wait up to ${MAX_WAIT_SECONDS} seconds for a job to finish, then return its status. Call again if done is false.`,
      inputSchema: z.object({
        job_id: z.string(),
        timeout_seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).default(MAX_WAIT_SECONDS),
      }),
      outputSchema: JobView,
      annotations: { readOnlyHint: true },
    },
    ({ job_id, timeout_seconds }) =>
      r(async () => {
        const deadline = Date.now() + Math.min(timeout_seconds, MAX_WAIT_SECONDS) * 1000;
        let view = await services.getJob(job_id);
        while (!view.done && Date.now() + pollMs < deadline) {
          await sleep(pollMs);
          view = await services.getJob(job_id);
        }
        return view;
      }),
  );

  server.registerTool(
    "list_voices",
    {
      title: "Voices",
      description:
        "Voices available to this user (their own ElevenLabs voices if connected, otherwise the free built-in voices).",
      outputSchema: z.object({ voices: z.array(Voice) }),
      annotations: { readOnlyHint: true },
    },
    () => r(async () => ({ voices: await services.listVoices() })),
  );

  server.registerTool(
    "list_caption_styles",
    {
      title: "Caption styles",
      description: "Animated caption presets for create_short.",
      outputSchema: z.object({ styles: z.array(CaptionStyle) }),
      annotations: { readOnlyHint: true },
    },
    () => r(async () => ({ styles: await services.listCaptionStyles() })),
  );

  server.registerTool(
    "estimate_cost",
    {
      title: "Estimate cost",
      description: "Credits a Short would use, and whether the user can afford it.",
      inputSchema: EstimateInput,
      outputSchema: EstimateOutput,
      annotations: { readOnlyHint: true },
    },
    (input) => r(() => services.estimateCost(input)),
  );

  server.registerTool(
    "swap_visual",
    {
      title: "Swap a visual",
      description:
        "Replace one shot of a rendered Short with a new AI image (optionally from your prompt) and re-render. Free. Returns a job to wait for.",
      inputSchema: SwapVisualInput,
      outputSchema: JobView,
    },
    (input) => r(() => services.swapVisual(input)),
  );

  server.registerTool(
    "approve_short",
    {
      title: "Approve a Short",
      description:
        "Mark a rendered Short as approved for publishing. Only after the user has watched it and said yes. Fails if any asset lacks a licence.",
      inputSchema: z.object({ project_id: z.string() }),
      outputSchema: ApproveOutput,
    },
    ({ project_id }) => r(() => services.approveShort(project_id)),
  );

  server.registerTool(
    "publish_short",
    {
      title: "Publish to YouTube",
      description:
        "Upload an approved Short to the user's connected YouTube channel (now, or scheduled). Requires approve_short first. Returns a job to wait for.",
      inputSchema: PublishInput,
      outputSchema: PublishOutput,
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    (input) => r(() => services.publishShort(input)),
  );

  server.registerTool(
    "get_credit_balance",
    {
      title: "Credit balance",
      description: "Shorts and AI-video credits the user has left, and their plan.",
      outputSchema: Balance,
      annotations: { readOnlyHint: true },
    },
    () => r(() => services.getCreditBalance()),
  );

  return server;
}

export const TOOL_NAMES = [
  "get_trends",
  "create_short",
  "get_job",
  "wait_for_job",
  "list_voices",
  "list_caption_styles",
  "estimate_cost",
  "swap_visual",
  "approve_short",
  "publish_short",
  "get_credit_balance",
] as const;

/**
 * Streamable HTTP handler (MCP 2026-07-28, with stateless serving for 2025-era clients). Each request builds a
 * server for the caller identified by `authInfo` (verified by the host before calling `fetch`).
 */
export function createShortLoopMcpHandler(
  servicesFor: (authInfo: AuthInfo) => ShortLoopServices | Promise<ShortLoopServices>,
  opts: BuildOptions = {},
): McpHttpHandler {
  return createMcpHandler(
    async (ctx) => {
      if (!ctx.authInfo) throw new Error("unauthenticated MCP request reached the handler");
      return buildShortLoopServer(await servicesFor(ctx.authInfo), opts);
    },
    { legacy: "stateless", onerror: opts.onError, responseMode: "json" },
  );
}
