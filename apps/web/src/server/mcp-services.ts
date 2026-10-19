import "server-only";
import { and, balance, eq, schema } from "@shortloop/db";
import { ToolUserError, type JobView, type ShortLoopServices } from "@shortloop/mcp";
import { ZodError } from "zod";
import { CAPTION_STYLES } from "../lib/captions";
import { accessOf } from "./access";
import { listChannels } from "./channels";
import { UserError } from "./errors";
import {
  approve,
  capabilities,
  createProject,
  projectView,
  requestAiScript,
  saveScript,
  startProduction,
  swapVisual,
} from "./projects";
import { publishShort } from "./publishing";
import { runtime } from "./runtime";

const STAGES = ["script", "voice", "visuals", "render"];
const DONE_PROJECT = new Set(["ready", "approved", "failed", "draft", "script_ready"]);
const DONE_PUBLISH = new Set(["published", "scheduled", "scheduled_next_window", "failed"]);

/** Turn the app's user-facing errors into tool errors the agent relays; keep everything else opaque. */
function relay<T extends object>(services: T): T {
  return new Proxy(services, {
    get(target, prop, receiver) {
      const fn = Reflect.get(target, prop, receiver) as unknown;
      if (typeof fn !== "function") return fn;
      return async (...args: unknown[]) => {
        try {
          return await (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (e) {
          if (e instanceof UserError) throw new ToolUserError(e.message);
          if (e instanceof ZodError) throw new ToolUserError(e.issues[0]?.message ?? "Invalid input");
          throw e;
        }
      };
    },
  });
}

async function projectJobView(userId: string, projectId: string, jobId: string): Promise<JobView> {
  const v = await projectView(userId, projectId);
  const status = v.project.status;
  const stage = v.job?.type && STAGES.includes(v.job.type) ? v.job.type : undefined;
  const stageIdx = stage ? STAGES.indexOf(stage) : 0;
  const done = DONE_PROJECT.has(status);
  return {
    job_id: jobId,
    kind: "production",
    project_id: projectId,
    status,
    stage: done ? undefined : stage,
    progress: done ? 1 : Math.min(0.99, (stageIdx + (v.job?.progress ?? 0)) / STAGES.length),
    done,
    error: v.project.error ?? undefined,
    video_url: status === "ready" || status === "approved" ? v.videoUrl : undefined,
    publishable: v.publishable.ok,
    problems: v.publishable.ok ? undefined : v.publishable.problems,
  };
}

/** The ShortLoop MCP tools for one signed-in user, on the same service functions as the web app. */
export function mcpServicesFor(userId: string): ShortLoopServices {
  const services: ShortLoopServices = {
    async getTrends() {
      return {
        available: false,
        message:
          "The trend radar launches in Q2. For now, suggest topics yourself and pass one to create_short.",
        trends: [],
      };
    },

    async createShort(input) {
      const rt = await runtime();
      if ((await balance(rt.db, userId, "short")) < 1)
        throw new UserError("You're out of Short credits. See Billing in the app.");
      const caps = await capabilities(userId);
      const voiceId = input.voice_id ?? caps.voices[0]?.id;
      if (!voiceId || !caps.voices.some((v) => v.id === voiceId))
        throw new UserError("Unknown voice. Use list_voices.");
      const projectId = await createProject(userId, {
        topic: input.topic,
        angle: input.angle,
        targetSeconds: input.length_seconds,
        tone: input.tone,
      });
      const produce = { voiceId, captionStyle: input.caption_style, imageStyle: input.image_style };
      let jobId: string;
      if (input.script) {
        const saved = await saveScript(userId, projectId, {
          title: input.script.title,
          beats: input.script.beats.map((b) => ({ text: b.text, visualQuery: b.visual })),
          cta: input.script.cta,
        });
        if (!saved.ok) {
          throw new UserError(
            saved.variation?.length
              ? `Too close to one of this channel's recent Shorts: ${saved.variation.join(" ")} Change the angle.`
              : saved.problems.join(" "),
          );
        }
        jobId = await startProduction(userId, projectId, produce);
      } else {
        if (!caps.aiScripts) {
          throw new UserError(
            "AI scripts need the user's own AI key (Settings → API keys in ShortLoop). Or pass your own `script`.",
          );
        }
        jobId = await requestAiScript(userId, projectId, produce);
      }
      return {
        project_id: projectId,
        job_id: jobId,
        status: input.script ? "producing" : "scripting",
        next: "Call wait_for_job with this job_id.",
      };
    },

    async getJob(jobId) {
      const rt = await runtime();
      const job = await rt.db.query.jobs.findFirst({
        where: and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, userId)),
      });
      if (!job) throw new UserError("Unknown job.");
      if (job.type === "publish") {
        const rec = await rt.db.query.publishRecords.findFirst({
          where: and(eq(schema.publishRecords.jobId, jobId), eq(schema.publishRecords.ownerId, userId)),
        });
        const status = rec?.status ?? job.status;
        return {
          job_id: jobId,
          kind: "publish",
          project_id: rec?.projectId ?? undefined,
          status,
          progress: DONE_PUBLISH.has(status) ? 1 : job.progress,
          done: DONE_PUBLISH.has(status),
          error: rec?.error ?? job.error ?? undefined,
          url: rec?.url ?? undefined,
          retry_at: rec?.retryAt ?? undefined,
        };
      }
      const input = job.input as { projectId?: string; chain?: { projectId?: string } };
      const projectId = input.chain?.projectId ?? input.projectId;
      if (!projectId) throw new UserError("That job isn't part of a Short.");
      return projectJobView(userId, projectId, jobId);
    },

    async listVoices() {
      return (await capabilities(userId)).voices.map((v) => ({
        id: v.id,
        label: v.label,
        language: v.language,
        provider: v.provider,
        commercial_use: v.commercialUse,
      }));
    },

    async listCaptionStyles() {
      return CAPTION_STYLES.map((c) => ({ id: c.id, label: c.label, description: c.hint }));
    },

    async estimateCost(input) {
      const rt = await runtime();
      const shorts = await balance(rt.db, userId, "short");
      const ai = await balance(rt.db, userId, "ai_video_credit");
      const needAi = Math.ceil(input.ai_video_seconds / 5);
      return {
        shorts: 1,
        ai_video_credits: needAi,
        balance: { shorts, ai_video_credits: ai },
        affordable: (await accessOf(userId)).unlimited || (shorts >= 1 && ai >= needAi),
        note: "One Short credit per Short, whatever the length. Re-renders and visual swaps are free. AI usage runs on the user's own keys.",
      };
    },

    async swapVisual(input) {
      const jobId = await swapVisual(userId, input.project_id, input.shot - 1, {
        kind: "ai",
        prompt: input.prompt,
      });
      return projectJobView(userId, input.project_id, jobId);
    },

    async approveShort(projectId) {
      await approve(userId, projectId);
      return { project_id: projectId, approved: true as const };
    },

    async publishShort(input) {
      const view = await projectView(userId, input.project_id);
      const channels = (await listChannels(userId)).filter((c) => c.status === "connected");
      const channel = input.channel_id
        ? channels.find((c) => c.id === input.channel_id)
        : channels.length === 1
          ? channels[0]
          : undefined;
      if (!channel) {
        throw new UserError(
          channels.length === 0
            ? "No YouTube channel is connected. The user can connect one under Channels in ShortLoop."
            : `Pick a channel_id: ${channels.map((c) => `${c.id} (${c.title})`).join(", ")}`,
        );
      }
      const publishId = await publishShort(
        userId,
        input.project_id,
        {
          channelId: channel.id,
          title: input.title ?? (view.script?.title ?? view.project.title).slice(0, 100),
          description: input.description ?? (view.script ? `${view.script.hook}\n\n${view.script.cta}` : ""),
          tags: input.tags,
          privacy: input.privacy,
          scheduledAt: input.scheduled_at,
          aiDisclosure: input.ai_label,
        },
        view.aiDisclosureRequired,
      );
      const rt = await runtime();
      const rec = await rt.db.query.publishRecords.findFirst({
        where: eq(schema.publishRecords.id, publishId),
      });
      return {
        publish_id: publishId,
        job_id: rec?.jobId ?? "",
        status: rec?.status ?? "queued",
        next: "Call wait_for_job with this job_id.",
      };
    },

    async getCreditBalance() {
      const rt = await runtime();
      return {
        shorts: await balance(rt.db, userId, "short"),
        ai_video_credits: await balance(rt.db, userId, "ai_video_credit"),
      };
    },
  };
  return relay(services);
}
