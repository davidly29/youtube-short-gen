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
  topic_id: z
    .string()
    .regex(/^top_[A-Za-z0-9_]{1,60}$/)
    .optional()
    .describe("The topic_id of a get_trends idea this Short is made from (keeps it out of later briefs)."),
  channel_voice_id: z
    .string()
    .max(80)
    .optional()
    .describe("A channel id from list_channels whose learned voice the script should follow."),
  library_asset_ids: z
    .array(z.string().max(100))
    .max(30)
    .optional()
    .describe(
      "The user's own uploads (from list_library) to use on the beats they match, before stock or AI.",
    ),
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(50)
    .default(0)
    .describe("Wait up to this long for the Short to finish before returning (like wait_for_job)."),
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
  app_url: z.string().optional().describe("Where the user can watch, edit and approve it in ShortLoop."),
  job: JobView.optional().describe("The job's state after waiting, when wait_seconds > 0."),
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

export const TrendsInput = z.object({
  niche: z.string().max(80).optional().describe("Filter by niche name or id, e.g. 'history' or 'tech'."),
  channel_id: z.string().max(80).optional().describe("Only this channel's brief (from list_channels)."),
});
export const TrendIdea = z.object({
  topic: z.string().describe("Pass as create_short.topic."),
  topic_id: z.string().describe("Pass as create_short.topic_id."),
  angle: z.string().describe("Pass as create_short.angle."),
  hook: z.string(),
  format: z.string().describe("Format slug for get_workflow."),
  why_now: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  channel_id: z.string(),
  channel_title: z.string(),
  already_made: z.boolean().describe("The user already started a Short from this idea."),
});
export const TrendsOutput = z.object({
  available: z.boolean(),
  message: z.string(),
  date: z.string().optional(),
  trends: z.array(TrendIdea),
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

export const AppLink = z.string().describe("Link to this in the ShortLoop app.");

export const ChannelView = z.object({
  channel_id: z.string(),
  platform: z.string(),
  title: z.string(),
  status: z.string().describe("connected or needs_reconnect"),
  publishable: z.boolean().describe("false while the user is over their plan's channel limit"),
  niche: z.string().optional().describe("The niche its daily brief covers"),
  stats: z.boolean().describe("Whether ShortLoop can read this channel's YouTube stats"),
});

export const AccountOutput = z.object({
  name: z.string().optional(),
  plan: z.string(),
  unlimited: z.boolean().describe("Admin or beta access: no credits needed"),
  credits: Balance,
  ai_scripts: z.boolean().describe("Whether create_short can write the script (the user has an AI key)"),
  channels: z.array(ChannelView),
  app_url: AppLink,
  tips: z.array(z.string()).describe("What to set up next, if anything"),
});

export const ListShortsInput = z.object({
  status: z
    .enum(["any", "in_progress", "ready", "approved", "published", "failed"])
    .default("any")
    .describe("in_progress = being scripted or rendered"),
  limit: z.number().int().min(1).max(50).default(10),
});
export const ShortSummary = z.object({
  project_id: z.string(),
  title: z.string(),
  status: z.string(),
  created_at: z.string(),
  published_urls: z.array(z.string()),
  app_url: AppLink,
});
export const ListShortsOutput = z.object({ shorts: z.array(ShortSummary) });

export const ShortDetail = z.object({
  project_id: z.string(),
  title: z.string(),
  topic: z.string().optional(),
  status: z.string(),
  error: z.string().optional(),
  job_id: z.string().optional().describe("The latest job, for wait_for_job"),
  script: z
    .object({
      title: z.string(),
      hook: z.string(),
      beats: z.array(z.object({ shot: z.number(), text: z.string(), visual: z.string() })),
      cta: z.string(),
    })
    .optional(),
  video_url: z.string().optional().describe("Signed MP4 link (expires in an hour)"),
  thumbnail_url: z.string().optional(),
  captions: z
    .array(z.object({ index: z.number(), text: z.string() }))
    .optional()
    .describe("Caption words with their index, for update_captions"),
  shots: z
    .array(z.object({ shot: z.number(), source: z.string() }))
    .optional()
    .describe("Where each shot's visual came from (stock, ai_generated, upload)"),
  publishable: z.boolean(),
  problems: z.array(z.string()),
  ai_label_required: z.boolean(),
  publishes: z.array(z.object({ channel_title: z.string(), status: z.string(), url: z.string().optional() })),
  stats: z
    .object({ views: z.number(), avg_view_pct: z.number().optional(), likes: z.number(), days: z.number() })
    .optional(),
  notices: z.array(z.string()),
  app_url: AppLink,
});

export const UpdateCaptionsInput = z.object({
  project_id: z.string(),
  edits: z
    .array(z.object({ index: z.number().int().min(0), text: z.string().min(1).max(40) }))
    .min(1)
    .max(100)
    .describe("Caption word index (from get_short.captions) and the corrected word"),
});

export const RecommendationsInput = z.object({
  channel_id: z.string().optional().describe("Defaults to the user's only connected channel."),
});
export const RecommendationsOutput = z.object({
  channel_id: z.string(),
  preferred_formats: z.array(z.string()),
  hook_types: z.array(z.string()),
  length_seconds: z.number(),
  post_hour_utc: z.number(),
  why: z.array(z.object({ field: z.string(), reason: z.string() })),
  based_on_shorts: z.number(),
});

export const PerformanceOutput = z.object({
  shorts: z.array(
    z.object({
      project_id: z.string().optional(),
      title: z.string(),
      channel_title: z.string(),
      url: z.string().optional(),
      views: z.number(),
      avg_view_pct: z.number().optional(),
      likes: z.number(),
      comments: z.number(),
      subs_gained: z.number(),
      days: z.number(),
    }),
  ),
  reconnect: z.array(z.string()).describe("Channels to reconnect in the app before their stats show"),
});

export const GuideOutput = z.object({ markdown: z.string() });

const OwnershipAttestation = z
  .boolean()
  .describe(
    "true only if the user has told you they own this media or have the rights to use it. Uploads are refused without it.",
  );

export const CreateUploadInput = z.object({
  filename: z.string().min(1).max(200).describe("e.g. 'my-trip.mp4'. MP4, MOV, PNG, JPG, MP3 or WAV."),
  content_type: z.string().max(100).default("").describe("e.g. video/mp4 (optional)"),
  size_bytes: z.number().int().nonnegative().describe("File size; files over 2 GB are refused."),
  i_own_this_media: OwnershipAttestation,
});
export const CreateUploadOutput = z.object({
  upload_key: z.string(),
  upload_url: z.string().describe("PUT the raw file bytes here (expires in an hour)."),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  next: z.string(),
});

export const FinishUploadInput = z.object({
  upload_key: z.string().min(1).max(300),
  filename: z.string().min(1).max(200),
  i_own_this_media: OwnershipAttestation,
});

export const LibraryItem = z.object({
  asset_id: z.string(),
  kind: z.string().describe("video, image or audio"),
  title: z.string(),
  duration_ms: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  preview_url: z.string().describe("Signed link (expires in an hour)"),
});
export const ListLibraryOutput = z.object({ assets: z.array(LibraryItem) });
