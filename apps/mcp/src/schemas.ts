import { CaptionStyleId, Privacy } from "@shortloop/contracts";
import { z } from "zod";

/** Tool input/output shapes. Field names are snake_case for agents; the services map them onto the app's contracts. */

export const Length = z.union([z.literal(30), z.literal(45), z.literal(60)]);

export const ScriptInput = z.object({
  title: z.string().min(1).max(100),
  beats: z
    .array(
      z.object({
        text: z.string().min(1).max(400).describe("What the narrator says in this beat. Beat 1 is the hook."),
        visual: z
          .string()
          .min(1)
          .max(200)
          .describe("What to show while it's said (used to find or generate a visual)."),
      }),
    )
    .min(2)
    .max(12),
  cta: z.string().max(200).default("Follow for more."),
});

export const CreateShortInput = z.object({
  topic: z
    .string()
    .min(3)
    .max(300)
    .describe("What the Short is about, e.g. 'why octopuses have three hearts'."),
  angle: z.string().max(300).optional().describe("Optional take or framing."),
  length_seconds: Length.default(45),
  tone: z.string().min(2).max(40).default("curious"),
  voice_id: z.string().optional().describe("From list_voices. Defaults to the first available voice."),
  caption_style: CaptionStyleId.default("bold-pop").describe("From list_caption_styles."),
  image_style: z
    .string()
    .max(40)
    .default("cinematic")
    .describe("Look for AI images: photoreal, cinematic, 3d, hand-drawn, whiteboard, storyboard, anime."),
  script: ScriptInput.optional().describe(
    "Your own script. Omit to have ShortLoop write one with the user's AI key (needs a key in Settings → API keys).",
  ),
});

export const JobView = z.object({
  job_id: z.string(),
  kind: z.enum(["production", "publish"]),
  project_id: z.string().optional(),
  status: z
    .string()
    .describe(
      "production: scripting, producing, ready, approved, failed. publish: queued, uploading, published, scheduled, scheduled_next_window, failed.",
    ),
  stage: z.string().optional().describe("script, voice, visuals or render while producing"),
  progress: z.number().min(0).max(1),
  done: z.boolean().describe("true when nothing more will happen without another tool call"),
  error: z.string().optional(),
  video_url: z.string().optional().describe("Signed link to the rendered MP4 (expires in an hour)."),
  publishable: z.boolean().optional(),
  problems: z.array(z.string()).optional(),
  url: z.string().optional().describe("The YouTube URL once published or scheduled."),
  retry_at: z.string().optional(),
});
export type JobView = z.infer<typeof JobView>;

export const CreateShortOutput = z.object({
  project_id: z.string(),
  job_id: z.string(),
  status: z.string(),
  next: z.string(),
});

export const Voice = z.object({
  id: z.string(),
  label: z.string(),
  language: z.string(),
  provider: z.string(),
  commercial_use: z.boolean(),
});
export const CaptionStyle = z.object({ id: CaptionStyleId, label: z.string(), description: z.string() });

export const EstimateInput = z.object({
  length_seconds: Length.default(45),
  ai_video_seconds: z.number().int().min(0).max(60).default(0),
});
export const Balance = z.object({
  shorts: z.number(),
  ai_video_credits: z.number(),
  plan: z.string().optional(),
});
export const EstimateOutput = z.object({
  shorts: z.number(),
  ai_video_credits: z.number(),
  balance: Balance,
  affordable: z.boolean(),
  note: z.string(),
});

export const SwapVisualInput = z.object({
  project_id: z.string(),
  shot: z.number().int().min(1).describe("1-based shot number"),
  prompt: z.string().max(300).optional().describe("Describe the new image; defaults to the beat's visual."),
});

export const ApproveOutput = z.object({ project_id: z.string(), approved: z.literal(true) });

export const PublishInput = z.object({
  project_id: z.string(),
  channel_id: z.string().optional().describe("Defaults to the user's only connected channel."),
  title: z.string().min(1).max(100).optional().describe("Defaults to the script title."),
  description: z.string().max(4500).optional(),
  tags: z.array(z.string().min(1).max(60)).max(30).default([]),
  privacy: Privacy.default("public"),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO time to go live (uploads private until then)."),
  ai_label: z
    .boolean()
    .default(false)
    .describe("Add YouTube's altered/synthetic label. Forced on when required."),
});
export const PublishOutput = z.object({
  publish_id: z.string(),
  job_id: z.string(),
  status: z.string(),
  next: z.string(),
});

export const TrendsInput = z.object({ niche: z.string().max(80).optional() });
export const TrendsOutput = z.object({
  available: z.boolean(),
  message: z.string(),
  trends: z.array(z.object({ topic: z.string(), why_now: z.string() })),
});

export const WorkflowPhase = z.enum(["start", "script", "visuals", "publish"]);
export const ListWorkflowsOutput = z.object({
  workflows: z.array(z.object({ slug: z.string(), title: z.string(), summary: z.string() })),
});
export const GetWorkflowInput = z.object({
  slug: z.string().min(1).max(60).describe("From list_workflows, e.g. 'news-in-60s'."),
  phase: WorkflowPhase.describe("Follow the phases in order: start, script, visuals, publish."),
});
export const GetWorkflowOutput = z.object({
  slug: z.string(),
  phase: WorkflowPhase,
  markdown: z.string().describe("Step-by-step instructions for this phase."),
});
