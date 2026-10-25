import {
  ApiError,
  CreateWebhook,
  DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_EVENTS,
  WEBHOOK_TOLERANCE_SECONDS,
  Webhook,
  WebhookCreated,
  WebhookDelivery,
  WebhookPayload,
} from "@shortloop/contracts";
import {
  AccountOutput,
  ApproveOutput,
  Balance,
  CaptionStyle,
  CreateShortInput,
  CreateShortOutput,
  CreateUploadInput,
  CreateUploadOutput,
  EstimateInput,
  EstimateOutput,
  FinishUploadInput,
  LibraryItem,
  ListLibraryOutput,
  GetWorkflowOutput,
  JobView,
  ListShortsInput,
  ListShortsOutput,
  ListWorkflowsOutput,
  MAX_WAIT_SECONDS,
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
  WorkflowPhase,
} from "@shortloop/mcp";
import { z } from "zod";

/**
 * The public REST API (E12-01), described once. The router dispatches on these operations and the OpenAPI 3.1
 * document is generated from them, so the spec can't drift from what the server accepts and returns.
 * Bodies reuse the MCP tool schemas: every endpoint mirrors an MCP tool and calls the same service.
 * This module must stay importable outside Next.js (the `openapi` script imports it).
 */

export type Method = "get" | "post" | "delete";

export interface Operation {
  id: string;
  method: Method;
  /** OpenAPI path under `/api/v1`, with `{param}` placeholders. */
  path: string;
  tag: "Shorts" | "Jobs" | "Library" | "Account" | "Workflows" | "Webhooks" | "Meta";
  summary: string;
  description?: string;
  /** The MCP tool this endpoint mirrors. */
  mcpTool?: string;
  /** Public operations need no API key (only the spec itself). */
  public?: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: { name: string; schema: z.ZodType };
  response: { status: 200 | 201 | 202; name: string; schema: z.ZodType };
}

export const RATE_LIMIT_PER_MINUTE = DEFAULT_API_RATE_LIMIT_PER_MINUTE;

const ProjectParam = z.object({ project_id: z.string().describe("From POST /shorts.") });

export const JobQuery = z.object({
  wait: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_SECONDS)
    .default(0)
    .describe(`Hold the request up to this many seconds (max ${MAX_WAIT_SECONDS}) until the job is done.`),
});

export const TrendsQuery = TrendsInput;
/** Query strings arrive as text: coerce the limit. */
export const ShortsQuery = ListShortsInput.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const RecommendationsQuery = RecommendationsInput;
export const CaptionsBody = UpdateCaptionsInput.omit({ project_id: true });

export const SwapBody = SwapVisualInput.omit({ project_id: true });
export const PublishBody = PublishInput.omit({ project_id: true });

export const VoiceList = z.object({ voices: z.array(Voice) });
export const CaptionStyleList = z.object({ styles: z.array(CaptionStyle) });
export const WebhookList = z.object({ webhooks: z.array(Webhook) });
export const DeliveryList = z.object({ deliveries: z.array(WebhookDelivery) });
export const Deleted = z.object({ id: z.string(), deleted: z.literal(true) });
export const OpenApiDocument = z.object({ openapi: z.string() }).loose();

export const OPERATIONS: Operation[] = [
  {
    id: "createShort",
    method: "post",
    path: "/shorts",
    tag: "Shorts",
    mcpTool: "create_short",
    summary: "Create a Short",
    description:
      "Start making an original Short from a topic: script (written with the user's AI key, or the `script` you pass), voiceover, visuals, captions and render. Uses 1 Short credit. Poll or wait on the returned job.",
    body: { name: "CreateShortInput", schema: CreateShortInput },
    response: { status: 202, name: "CreateShortOutput", schema: CreateShortOutput },
  },
  {
    id: "listShorts",
    method: "get",
    path: "/shorts",
    tag: "Shorts",
    mcpTool: "list_shorts",
    summary: "The account's Shorts, newest first",
    query: ShortsQuery,
    response: { status: 200, name: "ListShortsOutput", schema: ListShortsOutput },
  },
  {
    id: "getShort",
    method: "get",
    path: "/shorts/{project_id}",
    tag: "Shorts",
    mcpTool: "get_short",
    summary: "Everything about one Short",
    description:
      "Status, script with shots, signed video and thumbnail links, caption words (for /captions), visual sources, whether it can be published, publishes, stats and a link into the app.",
    params: ProjectParam,
    response: { status: 200, name: "ShortDetail", schema: ShortDetail },
  },
  {
    id: "updateCaptions",
    method: "post",
    path: "/shorts/{project_id}/captions",
    tag: "Shorts",
    mcpTool: "update_captions",
    summary: "Fix caption words and re-render",
    description:
      "Free. Indexes come from GET /shorts/{project_id}. Clears any approval. Returns a job to wait on.",
    params: ProjectParam,
    body: { name: "UpdateCaptionsInput", schema: CaptionsBody },
    response: { status: 202, name: "JobView", schema: JobView },
  },
  {
    id: "approveShort",
    method: "post",
    path: "/shorts/{project_id}/approve",
    tag: "Shorts",
    mcpTool: "approve_short",
    summary: "Approve a rendered Short for publishing",
    description: "Only after a person has watched it. Publishing is refused until the Short is approved.",
    params: ProjectParam,
    response: { status: 200, name: "ApproveOutput", schema: ApproveOutput },
  },
  {
    id: "swapVisual",
    method: "post",
    path: "/shorts/{project_id}/visuals",
    tag: "Shorts",
    mcpTool: "swap_visual",
    summary: "Replace one shot with a new AI image and re-render",
    description: "Free. Clears any approval, since the video changes. Returns a job to wait on.",
    params: ProjectParam,
    body: { name: "SwapVisualInput", schema: SwapBody },
    response: { status: 202, name: "JobView", schema: JobView },
  },
  {
    id: "publishShort",
    method: "post",
    path: "/shorts/{project_id}/publish",
    tag: "Shorts",
    mcpTool: "publish_short",
    summary: "Publish an approved Short",
    description:
      "Upload to the user's connected YouTube channel now or at `scheduled_at`. Requires approval first. Returns a job to wait on; `publish.completed` fires when it's live or scheduled.",
    params: ProjectParam,
    body: { name: "PublishInput", schema: PublishBody },
    response: { status: 202, name: "PublishOutput", schema: PublishOutput },
  },
  {
    id: "getJob",
    method: "get",
    path: "/jobs/{job_id}",
    tag: "Jobs",
    mcpTool: "get_job / wait_for_job",
    summary: "Job status (optionally wait for it)",
    description:
      "Status of a production or publish job, with the signed video link or the YouTube URL when done. Pass `wait` to hold the request until the job is done (like the MCP `wait_for_job` tool).",
    params: z.object({ job_id: z.string() }),
    query: JobQuery,
    response: { status: 200, name: "JobView", schema: JobView },
  },
  {
    id: "listVoices",
    method: "get",
    path: "/voices",
    tag: "Account",
    mcpTool: "list_voices",
    summary: "Voices available to this account",
    response: { status: 200, name: "VoiceList", schema: VoiceList },
  },
  {
    id: "listCaptionStyles",
    method: "get",
    path: "/caption-styles",
    tag: "Account",
    mcpTool: "list_caption_styles",
    summary: "Caption styles",
    response: { status: 200, name: "CaptionStyleList", schema: CaptionStyleList },
  },
  {
    id: "estimateCost",
    method: "post",
    path: "/estimate",
    tag: "Account",
    mcpTool: "estimate_cost",
    summary: "What a Short will cost, and whether the account can afford it",
    body: { name: "EstimateInput", schema: EstimateInput },
    response: { status: 200, name: "EstimateOutput", schema: EstimateOutput },
  },
  {
    id: "getBalance",
    method: "get",
    path: "/balance",
    tag: "Account",
    mcpTool: "get_credit_balance",
    summary: "Credit balance",
    response: { status: 200, name: "Balance", schema: Balance },
  },
  {
    id: "getTrends",
    method: "get",
    path: "/trends",
    tag: "Account",
    mcpTool: "get_trends",
    summary: "Today's ideas from the account's daily trend brief",
    query: TrendsQuery,
    response: { status: 200, name: "TrendsOutput", schema: TrendsOutput },
  },
  {
    id: "createUpload",
    method: "post",
    path: "/uploads",
    tag: "Library",
    mcpTool: "create_upload",
    summary: "Start an upload of the user's own media",
    description:
      "Only media the user owns or has rights to (`i_own_this_media: true`). PUT the bytes to `upload_url`, then POST /uploads/finish.",
    body: { name: "CreateUploadInput", schema: CreateUploadInput },
    response: { status: 201, name: "CreateUploadOutput", schema: CreateUploadOutput },
  },
  {
    id: "finishUpload",
    method: "post",
    path: "/uploads/finish",
    tag: "Library",
    mcpTool: "finish_upload",
    summary: "Record an uploaded file in the library",
    body: { name: "FinishUploadInput", schema: FinishUploadInput },
    response: { status: 201, name: "LibraryItem", schema: LibraryItem },
  },
  {
    id: "listLibrary",
    method: "get",
    path: "/library",
    tag: "Library",
    mcpTool: "list_library",
    summary: "The user's own uploads",
    response: { status: 200, name: "ListLibraryOutput", schema: ListLibraryOutput },
  },
  {
    id: "getAccount",
    method: "get",
    path: "/account",
    tag: "Account",
    mcpTool: "get_account",
    summary: "Plan, credits, channels and what to set up next",
    response: { status: 200, name: "AccountOutput", schema: AccountOutput },
  },
  {
    id: "getRecommendations",
    method: "get",
    path: "/recommendations",
    tag: "Account",
    mcpTool: "get_recommendations",
    summary: "Formats, hooks, length and posting hour that work for a channel",
    query: RecommendationsQuery,
    response: { status: 200, name: "RecommendationsOutput", schema: RecommendationsOutput },
  },
  {
    id: "getPerformance",
    method: "get",
    path: "/performance",
    tag: "Account",
    mcpTool: "get_performance",
    summary: "Views and retention per published Short",
    response: { status: 200, name: "PerformanceOutput", schema: PerformanceOutput },
  },
  {
    id: "listWorkflows",
    method: "get",
    path: "/workflows",
    tag: "Workflows",
    mcpTool: "list_workflows",
    summary: "Short formats with step-by-step playbooks",
    response: { status: 200, name: "ListWorkflowsOutput", schema: ListWorkflowsOutput },
  },
  {
    id: "getWorkflow",
    method: "get",
    path: "/workflows/{slug}/{phase}",
    tag: "Workflows",
    mcpTool: "get_workflow",
    summary: "Instructions for one phase of a format",
    params: z.object({ slug: z.string().min(1).max(60), phase: WorkflowPhase }),
    response: { status: 200, name: "GetWorkflowOutput", schema: GetWorkflowOutput },
  },
  {
    id: "listWebhooks",
    method: "get",
    path: "/webhooks",
    tag: "Webhooks",
    summary: "Registered webhooks",
    response: { status: 200, name: "WebhookList", schema: WebhookList },
  },
  {
    id: "createWebhook",
    method: "post",
    path: "/webhooks",
    tag: "Webhooks",
    summary: "Register a webhook",
    description: `Events: ${WEBHOOK_EVENTS.join(", ")}. The signing secret is returned once.`,
    body: { name: "CreateWebhook", schema: CreateWebhook },
    response: { status: 201, name: "WebhookCreated", schema: WebhookCreated },
  },
  {
    id: "deleteWebhook",
    method: "delete",
    path: "/webhooks/{webhook_id}",
    tag: "Webhooks",
    summary: "Remove a webhook",
    description: "Pending deliveries for it are dropped.",
    params: z.object({ webhook_id: z.string() }),
    response: { status: 200, name: "Deleted", schema: Deleted },
  },
  {
    id: "listDeliveries",
    method: "get",
    path: "/webhooks/{webhook_id}/deliveries",
    tag: "Webhooks",
    summary: "Recent deliveries for a webhook (newest first, up to 50)",
    params: z.object({ webhook_id: z.string() }),
    response: { status: 200, name: "DeliveryList", schema: DeliveryList },
  },
  {
    id: "getOpenApi",
    method: "get",
    path: "/openapi.json",
    tag: "Meta",
    public: true,
    summary: "This OpenAPI document",
    response: { status: 200, name: "OpenApiDocument", schema: OpenApiDocument },
  },
];

type Json = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const s = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as Json;
  delete s.$schema;
  return s;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const ERROR_RESPONSES: Record<string, { description: string; rateLimited?: boolean }> = {
  "400": { description: "The request was invalid; `error.message` says why." },
  "401": { description: "Missing, unknown or revoked API key." },
  "404": { description: "No such resource for this account." },
  "429": { description: "Rate limit hit. Retry after `Retry-After` seconds.", rateLimited: true },
};

const RATE_HEADERS = {
  "X-RateLimit-Limit": {
    description: "Requests allowed per minute for this key.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Remaining": { description: "Requests left in this window.", schema: { type: "integer" } },
  "X-RateLimit-Reset": { description: "Unix time (seconds) the window resets.", schema: { type: "integer" } },
};

const DESCRIPTION = `Make, approve and publish original YouTube Shorts from your own systems. Every endpoint mirrors a tool of the
ShortLoop MCP server and runs the same code as the web app, with the same credits, approvals and checks.

**Authentication.** Create a key in ShortLoop under Settings → Developer and send it as \`Authorization: Bearer sl_...\`.
Keys act as the user who created them.

**Rate limits.** ${RATE_LIMIT_PER_MINUTE} requests per minute per key by default. Over the limit you get \`429\` with
\`Retry-After\` (seconds).

**Webhooks.** ShortLoop POSTs a JSON \`WebhookPayload\` for ${WEBHOOK_EVENTS.map((e) => `\`${e}\``).join(", ")}, with
\`ShortLoop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with your secret>\`. Reject
signatures older than ${WEBHOOK_TOLERANCE_SECONDS} seconds. Answer 2xx within 10 seconds; anything else is retried after 1 min, 5 min, 30 min,
2 h and 6 h. The payload \`id\` is the same across retries, so use it to ignore duplicates.`;

/** The OpenAPI 3.1 document for every operation (written to docs/api/openapi.yaml by `pnpm -F web openapi`). */
export function buildOpenApi(): Json {
  const schemas: Json = {
    ApiError: jsonSchema(ApiError, "output"),
    WebhookPayload: jsonSchema(WebhookPayload, "output"),
  };
  const paths: Record<string, Json> = {};
  for (const op of OPERATIONS) {
    schemas[op.response.name] ??= jsonSchema(op.response.schema, "output");
    if (op.body) schemas[`${op.body.name}Body`] ??= jsonSchema(op.body.schema, "input");
    const parameters = [
      ...Object.entries(op.params?.shape ?? {}).map(([name, s]) => ({
        name,
        in: "path",
        required: true,
        schema: jsonSchema(s as z.ZodType, "input"),
      })),
      ...Object.entries(op.query?.shape ?? {}).map(([name, s]) => {
        const schema = jsonSchema(s as z.ZodType, "input");
        const { description, ...rest } = schema;
        return {
          name,
          in: "query",
          required: false,
          ...(description ? { description } : {}),
          schema: rest,
        };
      }),
    ];
    const responses: Json = {
      [String(op.response.status)]: {
        description: op.summary,
        headers: op.public ? undefined : RATE_HEADERS,
        content: { "application/json": { schema: ref(op.response.name) } },
      },
    };
    for (const [status, r] of Object.entries(ERROR_RESPONSES)) {
      if (op.public && status !== "404") continue;
      if (status === "400" && !op.body && !op.query && !op.params) continue;
      responses[status] = {
        description: r.description,
        headers: r.rateLimited
          ? { "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } } }
          : undefined,
        content: { "application/json": { schema: ref("ApiError") } },
      };
    }
    paths[op.path] ??= {};
    (paths[op.path] as Json)[op.method] = {
      operationId: op.id,
      tags: [op.tag],
      summary: op.summary,
      ...(op.description || op.mcpTool
        ? {
            description: [op.description, op.mcpTool ? `MCP tool: \`${op.mcpTool}\`.` : undefined]
              .filter(Boolean)
              .join("\n\n"),
          }
        : {}),
      ...(op.public ? { security: [] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: ref(`${op.body.name}Body`) } },
            },
          }
        : {}),
      responses,
    };
  }
  return JSON.parse(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "ShortLoop API", version: "1.0.0", description: DESCRIPTION },
      servers: [{ url: "/api/v1" }],
      security: [{ apiKey: [] }],
      tags: ["Shorts", "Jobs", "Account", "Workflows", "Webhooks", "Meta"].map((name) => ({ name })),
      paths,
      webhooks: Object.fromEntries(
        WEBHOOK_EVENTS.map((e) => [
          e,
          {
            post: {
              summary: `Sent when ${e === "job.succeeded" ? "a Short finishes rendering" : e === "job.failed" ? "a production or publish fails for good" : "a Short is published or scheduled"}`,
              parameters: [
                {
                  name: "ShortLoop-Signature",
                  in: "header",
                  required: true,
                  schema: { type: "string" },
                  description: "t=<unix seconds>,v1=<hex HMAC-SHA256>",
                },
                { name: "ShortLoop-Event", in: "header", required: true, schema: { type: "string" } },
                { name: "ShortLoop-Delivery", in: "header", required: true, schema: { type: "string" } },
              ],
              requestBody: { content: { "application/json": { schema: ref("WebhookPayload") } } },
              responses: { "200": { description: "Any 2xx acknowledges the delivery." } },
            },
          },
        ]),
      ),
      components: {
        securitySchemes: {
          apiKey: { type: "http", scheme: "bearer", description: "A ShortLoop API key (sl_...)." },
        },
        schemas,
      },
    }),
  ) as Json;
}
