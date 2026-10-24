import "server-only";
import { DEFAULT_NICHES } from "@shortloop/contracts";
import { and, balance, desc, eq, inArray, schema } from "@shortloop/db";
import { recommend } from "@shortloop/pipeline";
import { hasAnalyticsScope } from "@shortloop/providers";
import { ToolUserError, type JobView, type ShortLoopServices } from "@shortloop/mcp";
import { ZodError } from "zod";
import { CAPTION_STYLES } from "../lib/captions";
import { accessOf } from "./access";
import { performanceFor } from "./analytics";
import { getTodayBrief } from "./brief";
import { channelAllowance, listChannels } from "./channels";
import { UserError } from "./errors";
import {
  approve,
  capabilities,
  createProject,
  listProjects,
  projectView,
  requestAiScript,
  saveScript,
  startProduction,
  swapVisual,
  updateCaptions,
} from "./projects";
import { publishShort } from "./publishing";
import { runtime } from "./runtime";

const STAGES = ["script", "voice", "visuals", "render"];
const IN_PROGRESS = new Set(["scripting", "producing"]);

/** A link into the web app (the same origin that serves /api/mcp). */
export function appUrl(path: string, env: Record<string, string | undefined> = process.env): string {
  const base = (env.BETTER_AUTH_URL ?? env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}
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
    async getTrends(input) {
      const briefs = await getTodayBrief(userId, input.channel_id);
      const wanted = input.niche?.trim().toLowerCase();
      const matches = briefs.filter(
        (b) => !wanted || b.niche?.id === wanted || b.niche?.name.toLowerCase().includes(wanted),
      );
      const trends = matches.flatMap((b) =>
        (b.brief?.items ?? []).map((i) => ({
          topic: i.sources[0]?.title ?? i.hook,
          topic_id: i.topicId,
          angle: i.angle,
          hook: i.hook,
          format: i.format,
          why_now: i.whyNow,
          sources: i.sources.map((src) => ({ title: src.title, url: src.url })),
          channel_id: b.channel.id,
          channel_title: b.channel.title,
          already_made: Boolean(b.started[i.topicId]),
        })),
      );
      const date = matches.map((b) => b.brief?.date).find(Boolean);
      let message: string;
      if (briefs.length === 0)
        message =
          "No channel is connected yet. The user connects YouTube under Channels in ShortLoop; until then, suggest topics yourself.";
      else if (!briefs.some((b) => b.niche))
        message = `Pick a niche for the channel on the Today page (${appUrl("/today")}) to get a daily brief. Niches: ${DEFAULT_NICHES.map((n) => n.name).join(", ")}.`;
      else if (trends.length === 0)
        message =
          "Nothing new in the brief yet (briefs are built each morning). Suggest a topic yourself or try tomorrow.";
      else
        message = `${trends.length} idea${trends.length === 1 ? "" : "s"} from today's brief. Pass topic, angle and topic_id to create_short.`;
      return { available: trends.length > 0, message, date, trends };
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
        topicId: input.topic_id,
        styleChannelId: input.channel_voice_id,
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
        app_url: appUrl(`/projects/${projectId}`),
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

    async getAccount() {
      const rt = await runtime();
      const [access, allowance, channels, caps, user] = await Promise.all([
        accessOf(userId),
        channelAllowance(userId),
        listChannels(userId),
        capabilities(userId),
        rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      ]);
      const rows = channels.length
        ? await rt.db
            .select({
              id: schema.channels.id,
              nicheId: schema.channels.nicheId,
              scopes: schema.channels.scopes,
            })
            .from(schema.channels)
            .where(
              inArray(
                schema.channels.id,
                channels.map((c) => c.id),
              ),
            )
        : [];
      const extra = new Map(rows.map((r) => [r.id, r]));
      const shorts = await balance(rt.db, userId, "short");
      const tips: string[] = [];
      if (!caps.aiScripts)
        tips.push(
          "Add an AI key (Settings → API keys) so ShortLoop can write scripts, or pass create_short.script.",
        );
      if (channels.length === 0) tips.push("Connect a YouTube channel under Channels to publish.");
      else if (!rows.some((r) => r.nicheId))
        tips.push("Pick a niche on the Today page to get a daily trend brief.");
      if (!access.unlimited && shorts < 1) tips.push("Out of Short credits: see Billing in the app.");
      return {
        name: user?.name ?? undefined,
        plan: access.unlimited ? `${allowance.planName} (unlimited)` : allowance.planName,
        unlimited: access.unlimited,
        credits: {
          shorts,
          ai_video_credits: await balance(rt.db, userId, "ai_video_credit"),
          plan: allowance.planName,
        },
        ai_scripts: caps.aiScripts,
        channels: channels.map((c) => {
          const e = extra.get(c.id);
          const niche = DEFAULT_NICHES.find((n) => n.id === e?.nicheId);
          return {
            channel_id: c.id,
            platform: c.platform,
            title: c.title,
            status: c.status,
            publishable: c.publishable,
            niche: niche?.name,
            stats: c.platform === "youtube" && hasAnalyticsScope(e?.scopes),
          };
        }),
        app_url: appUrl("/projects"),
        tips,
      };
    },

    async listShorts(input) {
      const rt = await runtime();
      const projects = await listProjects(userId);
      const ids = projects.map((p) => p.id);
      const pubs = ids.length
        ? await rt.db
            .select({
              projectId: schema.publishRecords.projectId,
              url: schema.publishRecords.url,
              status: schema.publishRecords.status,
            })
            .from(schema.publishRecords)
            .where(
              and(eq(schema.publishRecords.ownerId, userId), inArray(schema.publishRecords.projectId, ids)),
            )
            .orderBy(desc(schema.publishRecords.createdAt))
        : [];
      const urls = new Map<string, string[]>();
      for (const p of pubs) {
        if (!p.projectId || !p.url || (p.status !== "published" && p.status !== "scheduled")) continue;
        urls.set(p.projectId, [...(urls.get(p.projectId) ?? []), p.url]);
      }
      const keep = (status: string, id: string) => {
        switch (input.status) {
          case "in_progress":
            return IN_PROGRESS.has(status);
          case "published":
            return (urls.get(id)?.length ?? 0) > 0;
          case "any":
            return true;
          default:
            return status === input.status;
        }
      };
      return {
        shorts: projects
          .filter((p) => keep(p.status, p.id))
          .slice(0, input.limit)
          .map((p) => ({
            project_id: p.id,
            title: p.title,
            status: p.status,
            created_at: new Date(p.createdAt).toISOString(),
            published_urls: urls.get(p.id) ?? [],
            app_url: appUrl(`/projects/${p.id}`),
          })),
      };
    },

    async getShort(projectId) {
      const v = await projectView(userId, projectId);
      const perf = (await performanceFor(userId)).shorts.filter(
        (s) => s.projectId === projectId && s.days > 0,
      );
      const stats = perf.length
        ? {
            views: perf.reduce((n, s) => n + s.views, 0),
            avg_view_pct: perf[0]?.avgViewPct,
            likes: perf.reduce((n, s) => n + s.likes, 0),
            days: Math.max(...perf.map((s) => s.days)),
          }
        : undefined;
      const rendered = v.project.status === "ready" || v.project.status === "approved";
      return {
        project_id: projectId,
        title: v.script?.title ?? v.project.title,
        topic: v.project.topic ?? undefined,
        status: v.project.status,
        error: v.project.error ?? undefined,
        job_id: v.job?.id,
        script: v.script
          ? {
              title: v.script.title,
              hook: v.script.hook,
              beats: v.script.beats.map((b, i) => ({ shot: i + 1, text: b.text, visual: b.visualQuery })),
              cta: v.script.cta,
            }
          : undefined,
        video_url: rendered ? v.videoUrl : undefined,
        thumbnail_url: rendered ? v.thumbUrl : undefined,
        captions: v.captions.length ? v.captions.map((c, index) => ({ index, text: c.text })) : undefined,
        shots: v.beatsVisuals.length
          ? v.beatsVisuals.map((b, i) => ({ shot: i + 1, source: b.source }))
          : undefined,
        publishable: v.publishable.ok,
        problems: v.publishable.problems,
        ai_label_required: v.aiDisclosureRequired,
        publishes: v.publishes.map((p) => ({
          channel_title: p.channelTitle,
          status: p.status,
          url: p.url ?? undefined,
        })),
        stats,
        notices: v.project.notices,
        app_url: appUrl(`/projects/${projectId}`),
      };
    },

    async updateCaptions(input) {
      const jobId = await updateCaptions(userId, input.project_id, input.edits);
      return projectJobView(userId, input.project_id, jobId);
    },

    async getRecommendations(input) {
      const rt = await runtime();
      const channels = (await listChannels(userId)).filter((c) => c.platform === "youtube");
      const channel = input.channel_id
        ? channels.find((c) => c.id === input.channel_id)
        : channels.length === 1
          ? channels[0]
          : undefined;
      if (!channel)
        throw new UserError(
          channels.length === 0
            ? "Connect a YouTube channel first: recommendations learn from its Shorts."
            : `Pick a channel_id: ${channels.map((c) => `${c.id} (${c.title})`).join(", ")}`,
        );
      const rec = await recommend(rt.db, channel.id);
      return {
        channel_id: channel.id,
        preferred_formats: rec.preferredFormats,
        hook_types: rec.hookPatterns,
        length_seconds: rec.targetSeconds,
        post_hour_utc: rec.postHour,
        why: rec.why.map((w) => ({ field: w.field, reason: w.text })),
        based_on_shorts: rec.basedOn.shorts,
      };
    },

    async getPerformance() {
      const perf = await performanceFor(userId);
      return {
        shorts: perf.shorts.map((s) => ({
          project_id: s.projectId,
          title: s.title,
          channel_title: s.channelTitle,
          url: s.url,
          views: s.views,
          avg_view_pct: s.avgViewPct,
          likes: s.likes,
          comments: s.comments,
          subs_gained: s.subsGained,
          days: s.days,
        })),
        reconnect: perf.reconnect.map((c) => c.title),
      };
    },
  };
  return relay(services);
}
