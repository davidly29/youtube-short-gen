import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  AccountOutput,
  ApproveOutput,
  Balance,
  CaptionStyle,
  CreateShortInput,
  CreateShortOutput,
  EstimateInput,
  EstimateOutput,
  GetWorkflowInput,
  GetWorkflowOutput,
  GuideOutput,
  JobView,
  ListShortsInput,
  ListShortsOutput,
  ListWorkflowsOutput,
  PerformanceOutput,
  PublishInput,
  PublishOutput,
  RecommendationsInput,
  RecommendationsOutput,
  ShortDetail,
  SwapVisualInput,
  TrendsInput,
  TrendsOutput,
  UpdateCaptionsInput,
  Voice,
} from "./schemas";
import { getWorkflow, listWorkflows } from "./playbooks";
import { ToolUserError, type ShortLoopServices } from "./services";

export const MAX_WAIT_SECONDS = 50;

const INSTRUCTIONS = `ShortLoop makes original, rights-clean 9:16 YouTube Shorts and publishes them to the user's channel.
Start with get_account (plan, credits, channels, what to set up). For ideas, get_trends returns today's brief for the
user's channels (topic, angle, hook, format, sources); get_recommendations says which formats, hooks and length
work for a channel.
Make: create_short (topic, or a get_trends idea with its topic_id; wait_seconds up to 50) -> wait_for_job until done
-> show the user video_url and app_url -> fix with swap_visual / update_captions -> approve_short (only after the user
has watched it and said yes) -> publish_short -> wait_for_job. get_short shows everything about one Short;
list_shorts finds earlier ones; get_performance shows views and retention.
For a format (trend explainer, myth vs fact, top-3 list, news in 60s), list_workflows then get_workflow per phase.
Each Short uses one credit (estimate_cost). Never publish without the user's explicit OK. Call get_guide for more.`;

/** The getting-started guide (also served as the get_guide tool), like VideoGen's guidance tools. */
export const GUIDE = `# Making Shorts with ShortLoop

1. **Check the account**: \`get_account\`. If \`ai_scripts\` is false, either write the script yourself and pass
   \`create_short.script\`, or ask the user to add an AI key in ShortLoop (Settings → API keys).
   If there are no channels, the user connects YouTube under Channels in the app before publishing.
2. **Pick an idea**: \`get_trends\` (today's brief per channel) or the user's own topic. For a proven shape,
   \`get_recommendations\` for the channel and \`list_workflows\` / \`get_workflow\`.
3. **Make it**: \`create_short\` with the topic (and \`topic_id\`, \`angle\` from a trend idea). Pass
   \`wait_seconds: 50\` to wait in the same call, then keep calling \`wait_for_job\` until \`done\`. A 45 s Short
   usually takes 1–3 minutes.
4. **Review together**: give the user \`video_url\` (or \`app_url\`). Fix a shot with \`swap_visual\`, a caption
   word with \`update_captions\` (indexes from \`get_short\`). Re-renders are free.
5. **Approve and publish**: only after the user says yes, \`approve_short\`, then \`publish_short\` (now or
   \`scheduled_at\`; \`get_recommendations\` suggests an hour). Then \`wait_for_job\` for the YouTube link.
6. **Learn**: \`get_performance\` for views and average % viewed per Short.

Rules: never publish without explicit approval; one credit per Short; visuals come from licensed stock or AI,
never from other creators' videos.`;

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

/** Poll a job until it's done or the time is up. */
async function waitFor(services: ShortLoopServices, jobId: string, seconds: number, pollMs: number) {
  const deadline = Date.now() + Math.min(seconds, MAX_WAIT_SECONDS) * 1000;
  let view = await services.getJob(jobId);
  while (!view.done && Date.now() + pollMs < deadline) {
    await sleep(pollMs);
    view = await services.getJob(jobId);
  }
  return view;
}

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
        "Today's ready-to-make ideas from the user's daily trend brief, per channel: topic, angle, hook, format, why now and sources. Pass an idea's topic, angle and topic_id to create_short.",
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
        "Make an original Short from a topic in one call: script (written by the user's AI key, or the `script` you pass), voiceover, visuals, captions and render. Uses 1 credit. Returns a job_id for wait_for_job; pass wait_seconds to wait here first.",
      inputSchema: CreateShortInput,
      outputSchema: CreateShortOutput,
    },
    (input) =>
      r(async () => {
        const created = await services.createShort(input);
        if (!input.wait_seconds) return created;
        const job = await waitFor(services, created.job_id, input.wait_seconds, pollMs);
        return {
          ...created,
          status: job.status,
          job,
          next: job.done ? "Show the user the video_url, then ask before approve_short." : created.next,
        };
      }),
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
    ({ job_id, timeout_seconds }) => r(() => waitFor(services, job_id, timeout_seconds, pollMs)),
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

  server.registerTool(
    "list_workflows",
    {
      title: "Short formats",
      description:
        "Format playbooks (trend explainer, myth vs fact, top-3 list, news in 60s) with step-by-step instructions. Pick one, then call get_workflow for each phase in order.",
      outputSchema: ListWorkflowsOutput,
      annotations: { readOnlyHint: true },
    },
    () => r(async () => ({ workflows: listWorkflows() })),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Format instructions",
      description:
        "Markdown instructions for one phase (start, script, visuals, publish) of a format from list_workflows. Follow them before moving to the next phase.",
      inputSchema: GetWorkflowInput,
      outputSchema: GetWorkflowOutput,
      annotations: { readOnlyHint: true },
    },
    ({ slug, phase }) => r(async () => ({ slug, phase, markdown: getWorkflow(slug, phase) })),
  );

  server.registerTool(
    "get_account",
    {
      title: "Account",
      description:
        "Who is signed in: plan, credits, whether AI scripts are available, connected channels, and what to set up next. A good first call.",
      outputSchema: AccountOutput,
      annotations: { readOnlyHint: true },
    },
    () => r(() => services.getAccount()),
  );

  server.registerTool(
    "list_shorts",
    {
      title: "List Shorts",
      description: "The user's Shorts, newest first, with status, YouTube links and app links.",
      inputSchema: ListShortsInput,
      outputSchema: ListShortsOutput,
      annotations: { readOnlyHint: true },
    },
    (input) => r(() => services.listShorts(input)),
  );

  server.registerTool(
    "get_short",
    {
      title: "Short details",
      description:
        "Everything about one Short: status, script with shots, video and thumbnail links, caption words (for update_captions), where each visual came from, whether it can be published, publishes and stats.",
      inputSchema: z.object({ project_id: z.string() }),
      outputSchema: ShortDetail,
      annotations: { readOnlyHint: true },
    },
    ({ project_id }) => r(() => services.getShort(project_id)),
  );

  server.registerTool(
    "update_captions",
    {
      title: "Fix captions",
      description:
        "Correct caption words (typos, names) by index from get_short, then re-render. Free. Returns a job to wait for; the Short needs approving again.",
      inputSchema: UpdateCaptionsInput,
      outputSchema: JobView,
    },
    (input) => r(() => services.updateCaptions(input)),
  );

  server.registerTool(
    "get_recommendations",
    {
      title: "What works on this channel",
      description:
        "Formats, hook types, length and posting hour that retain this channel's audience, learned from its own Shorts (defaults until it has some), each with a reason. Suggestions only.",
      inputSchema: RecommendationsInput,
      outputSchema: RecommendationsOutput,
      annotations: { readOnlyHint: true },
    },
    (input) => r(() => services.getRecommendations(input)),
  );

  server.registerTool(
    "get_performance",
    {
      title: "Short stats",
      description:
        "Views, average % viewed, likes and subscribers per published Short, from each channel's own YouTube stats.",
      outputSchema: PerformanceOutput,
      annotations: { readOnlyHint: true },
    },
    () => r(() => services.getPerformance()),
  );

  server.registerTool(
    "get_guide",
    {
      title: "How to use ShortLoop",
      description: "Step-by-step guide to making, reviewing and publishing Shorts with these tools.",
      outputSchema: GuideOutput,
      annotations: { readOnlyHint: true },
    },
    () => r(async () => ({ markdown: GUIDE })),
  );

  server.registerPrompt(
    "make_a_short",
    {
      title: "Make a Short",
      description: "Make, review and (with your OK) publish a YouTube Short about a topic.",
      argsSchema: z.object({
        topic: z.string().optional().describe("Leave empty to pick from today's trend brief"),
      }),
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${topic ? `Make a YouTube Short about: ${topic}.` : "Pick the best idea from my ShortLoop trend brief (get_trends) and make a Short from it."}
Use ShortLoop: get_account first, then create_short with wait_seconds 50 and wait_for_job until it's done.
Show me the video link and the script, and ask before approving or publishing anything.`,
          },
        },
      ],
    }),
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
  "list_workflows",
  "get_workflow",
  "get_account",
  "list_shorts",
  "get_short",
  "update_captions",
  "get_recommendations",
  "get_performance",
  "get_guide",
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
