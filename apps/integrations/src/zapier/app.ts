import { CREATE_SHORT_FIELDS, toCreateShortBody } from "../fields";

/**
 * The ShortLoop Zapier app (Zapier Platform CLI format). Everything goes through the public REST API with the user's
 * `sl_…` key, so credits, approvals and the rights check apply exactly as in the web app.
 *
 * - Trigger "Short Rendered" (REST hook on `job.succeeded`, with a list fallback for testing).
 * - Trigger "New Brief Idea" (polls `GET /trends`; Zapier dedupes on `topic_id`).
 * - Action "Create Short" (`POST /shorts`).
 *
 * `scripts/build-zapier.ts` bundles this into a pushable app; `checklist.ts` holds the review checks.
 */

// Just the parts of Zapier's `z` and `bundle` objects we use, so the app type-checks without zapier-platform-core.
export interface ZRequest {
  url: string;
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface ZResponse {
  status: number;
  data: unknown;
  content: string;
  getHeader?(name: string): string | undefined;
}
type ZErrorCtor = new (message: string, code?: string, status?: number) => Error;
export interface ZObject {
  request(req: ZRequest): Promise<ZResponse>;
  errors: {
    Error: ZErrorCtor;
    ThrottledError: new (message: string, delaySeconds?: number) => Error;
  };
}
export interface Bundle {
  authData: { api_url?: string; api_key?: string };
  inputData: Record<string, unknown>;
  targetUrl?: string;
  subscribeData?: { id?: string };
  cleanedRequest?: unknown;
  meta?: { isLoadingSample?: boolean; isFillingDynamicDropdown?: boolean; limit?: number };
}

export const APP_VERSION = "1.0.0";
/** Pinned with the `zapier-platform-schema` dev dependency; the build pins `zapier-platform-core` to the same. */
export const ZAPIER_PLATFORM_VERSION = "19.2.1";

/** `https://app.example.com` or `.../api/v1/` → `https://app.example.com/api/v1`. */
export function apiBase(authData: Bundle["authData"]): string {
  const raw = (authData.api_url ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Add your ShortLoop app URL to the connection.");
  return /\/api\/v1$/.test(raw) ? raw : `${raw}/api/v1`;
}

const addAuth = (request: ZRequest, _z: ZObject, bundle: Bundle): ZRequest => {
  request.headers = {
    ...request.headers,
    authorization: `Bearer ${bundle.authData.api_key ?? ""}`,
    accept: "application/json",
  };
  return request;
};

/** Turn the API's `{ error: { code, message } }` envelope into an error Zapier shows the user as is. */
const handleErrors = (response: ZResponse, z: ZObject): ZResponse => {
  if (response.status < 400) return response;
  const err = (response.data as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (response.status === 401) {
    throw new z.errors.Error(
      "ShortLoop didn't accept this API key. Create a new one in ShortLoop → Settings → Developer and reconnect.",
      "unauthorized",
      401,
    );
  }
  if (response.status === 429) {
    const retry = Number(response.getHeader?.("retry-after") ?? 60);
    throw new z.errors.ThrottledError(
      err?.message ?? "ShortLoop's rate limit was hit.",
      Number.isFinite(retry) ? retry : 60,
    );
  }
  throw new z.errors.Error(
    err?.message ?? `ShortLoop returned HTTP ${response.status}.`,
    err?.code ?? "api_error",
    response.status,
  );
};

async function call<T>(
  z: ZObject,
  bundle: Bundle,
  req: Omit<ZRequest, "url"> & { path: string },
): Promise<T> {
  const { path, ...rest } = req;
  const res = await z.request({ ...rest, url: apiBase(bundle.authData) + path });
  return res.data as T;
}

// --- shapes we read (subset of docs/api/openapi.yaml) -------------------------------------------------------------

interface ShortDetail {
  project_id: string;
  title: string;
  topic: string;
  status: string;
  app_url: string;
  video_url?: string;
  thumbnail_url?: string;
  publishable?: boolean;
  problems?: string[];
  script?: {
    title: string;
    hook: string;
    beats: { shot: number; text: string; visual: string }[];
    cta: string;
  };
}
interface Trend {
  topic: string;
  topic_id: string;
  angle: string;
  hook: string;
  format: string;
  why_now: string;
  sources: { title: string; url: string }[];
  channel_id: string;
  channel_title: string;
  already_made: boolean;
}
interface WebhookEvent {
  id?: string;
  type?: string;
  created_at?: string;
  data?: { job_id?: string; kind?: string; project_id?: string; status?: string };
}

/** The flat record both Short triggers output, so a Zap built on the test sample sees the same fields live. */
export function shortRecord(s: ShortDetail, extra: { job_id?: string; event_id?: string } = {}) {
  return {
    id: s.project_id,
    project_id: s.project_id,
    title: s.title,
    topic: s.topic,
    status: s.status,
    app_url: s.app_url,
    video_url: s.video_url ?? "",
    thumbnail_url: s.thumbnail_url ?? "",
    publishable: s.publishable ?? false,
    problems: (s.problems ?? []).join("; "),
    hook: s.script?.hook ?? "",
    script: s.script ? s.script.beats.map((b) => b.text).join(" ") : "",
    job_id: extra.job_id ?? "",
    event_id: extra.event_id ?? "",
  };
}

const SHORT_SAMPLE = shortRecord(
  {
    project_id: "prj_sample",
    title: "Why octopuses have three hearts",
    topic: "why octopuses have three hearts",
    status: "ready",
    app_url: "https://shortloop.example/projects/prj_sample",
    video_url: "https://media.shortloop.example/prj_sample.mp4",
    thumbnail_url: "https://media.shortloop.example/prj_sample.jpg",
    publishable: true,
    problems: [],
    script: {
      title: "Why octopuses have three hearts",
      hook: "An octopus has three hearts, and one stops when it swims.",
      beats: [
        { shot: 1, text: "An octopus has three hearts, and one stops when it swims.", visual: "octopus" },
      ],
      cta: "Follow for more.",
    },
  },
  { job_id: "job_sample", event_id: "evt_sample" },
);

const SHORT_OUTPUT_FIELDS = [
  { key: "id", label: "Short ID" },
  { key: "project_id", label: "Project ID" },
  { key: "title", label: "Title" },
  { key: "topic", label: "Topic" },
  { key: "status", label: "Status" },
  { key: "app_url", label: "Review Link" },
  { key: "video_url", label: "Video URL (expires in an hour)" },
  { key: "thumbnail_url", label: "Thumbnail URL" },
  { key: "publishable", label: "Ready to Publish", type: "boolean" as const },
  { key: "problems", label: "Problems Blocking Publish" },
  { key: "hook", label: "Hook" },
  { key: "script", label: "Narration" },
  { key: "job_id", label: "Job ID" },
  { key: "event_id", label: "Event ID" },
];

// --- triggers ----------------------------------------------------------------------------------------------------

const subscribeShortRendered = async (z: ZObject, bundle: Bundle) =>
  call<{ id: string; secret: string }>(z, bundle, {
    path: "/webhooks",
    method: "POST",
    body: { url: bundle.targetUrl, events: ["job.succeeded"] },
  });

const unsubscribeShortRendered = async (z: ZObject, bundle: Bundle) => {
  const id = bundle.subscribeData?.id;
  if (!id) return {};
  return call<unknown>(z, bundle, { path: `/webhooks/${encodeURIComponent(id)}`, method: "DELETE" });
};

/**
 * A `job.succeeded` delivery. The payload only carries ids, so we read the Short back with the user's key: that
 * gives the Zap real fields and means a forged POST to the hook URL can't produce anything the user doesn't own.
 */
const performShortRendered = async (z: ZObject, bundle: Bundle) => {
  const event = (bundle.cleanedRequest ?? {}) as WebhookEvent;
  const projectId = event.data?.project_id;
  if (event.type !== "job.succeeded" || event.data?.kind !== "production" || !projectId) return [];
  const short = await call<ShortDetail>(z, bundle, { path: `/shorts/${encodeURIComponent(projectId)}` });
  return [shortRecord(short, { job_id: event.data.job_id, event_id: event.id })];
};

/** Test-time fallback: the latest rendered Shorts in the same shape as a live event. */
const listShortRendered = async (z: ZObject, bundle: Bundle) => {
  const { shorts } = await call<{ shorts: { project_id: string }[] }>(z, bundle, {
    path: "/shorts",
    params: { status: "ready", limit: "3" },
  });
  const out = [];
  for (const s of shorts) {
    const short = await call<ShortDetail>(z, bundle, { path: `/shorts/${encodeURIComponent(s.project_id)}` });
    out.push(shortRecord(short));
  }
  return out;
};

export function trendRecord(t: Trend) {
  return {
    id: t.topic_id,
    topic_id: t.topic_id,
    topic: t.topic,
    angle: t.angle,
    hook: t.hook,
    format: t.format,
    why_now: t.why_now,
    channel_id: t.channel_id,
    channel_title: t.channel_title,
    sources: t.sources.map((s) => `${s.title} (${s.url})`).join("\n"),
    first_source_url: t.sources[0]?.url ?? "",
  };
}

const performNewBriefIdea = async (z: ZObject, bundle: Bundle) => {
  const params: Record<string, string> = {};
  for (const k of ["niche", "channel_id"] as const) {
    const v = bundle.inputData[k];
    if (typeof v === "string" && v.trim()) params[k] = v.trim();
  }
  const res = await call<{ available: boolean; trends?: Trend[] }>(z, bundle, { path: "/trends", params });
  // Ideas the user already turned into a Short are left out so a Zap doesn't make the same Short twice.
  return (res.trends ?? []).filter((t) => !t.already_made).map(trendRecord);
};

const performVoiceList = async (z: ZObject, bundle: Bundle) => {
  const { voices } = await call<{ voices: { id: string; label: string; language: string }[] }>(z, bundle, {
    path: "/voices",
  });
  return voices.map((v) => ({ id: v.id, label: `${v.label} (${v.language})` }));
};

const performChannelList = async (z: ZObject, bundle: Bundle) => {
  const account = await call<{ channels: { channel_id: string; title: string; platform: string }[] }>(
    z,
    bundle,
    { path: "/account" },
  );
  return account.channels.map((c) => ({ id: c.channel_id, label: `${c.title} (${c.platform})` }));
};

// --- action ------------------------------------------------------------------------------------------------------

const DYNAMIC: Partial<Record<string, string>> = {
  voice_id: "voice.id.label",
  channel_voice_id: "channel.id.label",
  channel_id: "channel.id.label",
};

const createShortInputFields = CREATE_SHORT_FIELDS.map((f) => ({
  key: f.key,
  label: f.label,
  helpText: f.helpText,
  required: f.required ?? false,
  type: f.type,
  ...(f.choices ? { choices: f.choices.map((c) => ({ ...c, sample: c.value })) } : {}),
  ...(f.default ? { default: f.default } : {}),
  ...(DYNAMIC[f.key] ? { dynamic: DYNAMIC[f.key] } : {}),
}));

const performCreateShort = async (z: ZObject, bundle: Bundle) => {
  const res = await call<{
    project_id: string;
    job_id: string;
    status: string;
    next: string;
    app_url?: string;
  }>(z, bundle, { path: "/shorts", method: "POST", body: toCreateShortBody(bundle.inputData) });
  return { id: res.project_id, ...res, app_url: res.app_url ?? "" };
};

// --- the app -----------------------------------------------------------------------------------------------------

export const zapierApp = {
  version: APP_VERSION,
  platformVersion: ZAPIER_PLATFORM_VERSION,
  authentication: {
    type: "custom" as const,
    fields: [
      {
        key: "api_url",
        label: "ShortLoop App URL",
        required: true,
        type: "string" as const,
        helpText:
          "The address you open ShortLoop at, e.g. `https://app.shortloop.example`. Self-hosted and staging apps work too.",
      },
      {
        key: "api_key",
        label: "API Key",
        required: true,
        type: "password" as const,
        helpText:
          "An `sl_…` key from ShortLoop → **Settings → Developer → Create key**. The Zap acts as you: it uses your credits and your own AI keys.",
      },
    ],
    test: async (z: ZObject, bundle: Bundle) =>
      call<{ name: string; plan: string }>(z, bundle, { path: "/account" }),
    connectionLabel: "{{json.name}} ({{json.plan}})",
  },
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],
  triggers: {
    short_rendered: {
      key: "short_rendered",
      noun: "Short",
      display: {
        label: "Short Rendered",
        description: "Triggers when a Short finishes rendering and is ready to review.",
      },
      operation: {
        type: "hook" as const,
        performSubscribe: subscribeShortRendered,
        performUnsubscribe: unsubscribeShortRendered,
        perform: performShortRendered,
        performList: listShortRendered,
        sample: SHORT_SAMPLE,
        outputFields: SHORT_OUTPUT_FIELDS,
      },
    },
    new_brief_idea: {
      key: "new_brief_idea",
      noun: "Brief Idea",
      display: {
        label: "New Brief Idea",
        description: "Triggers when your daily trend brief has a new idea you haven't made yet.",
      },
      operation: {
        inputFields: [
          {
            key: "niche",
            label: "Niche",
            required: false,
            type: "string" as const,
            helpText:
              "Only ideas for this niche, e.g. history or tech. Leave empty for all your channels' niches.",
          },
          {
            key: "channel_id",
            label: "Channel",
            required: false,
            type: "string" as const,
            dynamic: "channel.id.label",
            helpText: "Only ideas from this channel's brief.",
          },
        ],
        perform: performNewBriefIdea,
        sample: {
          id: "top_sample_octopus",
          topic_id: "top_sample_octopus",
          topic: "Octopus intelligence study",
          angle: "What a new study says about how octopuses solve puzzles",
          hook: "Octopuses just solved a puzzle most toddlers can't.",
          format: "trend-explainer",
          why_now: "Search interest tripled in the last 24 hours.",
          channel_id: "ch_sample",
          channel_title: "Ocean Facts",
          sources: "New octopus study (https://news.example/octopus)",
          first_source_url: "https://news.example/octopus",
        },
        outputFields: [
          { key: "id", label: "Idea ID" },
          { key: "topic_id", label: "Topic ID" },
          { key: "topic", label: "Topic" },
          { key: "angle", label: "Angle" },
          { key: "hook", label: "Hook" },
          { key: "format", label: "Format" },
          { key: "why_now", label: "Why Now" },
          { key: "channel_id", label: "Channel ID" },
          { key: "channel_title", label: "Channel" },
          { key: "sources", label: "Sources" },
          { key: "first_source_url", label: "First Source URL" },
        ],
      },
    },
    voice: {
      key: "voice",
      noun: "Voice",
      display: {
        label: "New Voice",
        description: "Triggers when a voice is available (for dropdowns).",
        hidden: true,
      },
      operation: { perform: performVoiceList, sample: { id: "en-US-AriaNeural", label: "Aria (en-US)" } },
    },
    channel: {
      key: "channel",
      noun: "Channel",
      display: {
        label: "New Channel",
        description: "Triggers when a channel is connected (for dropdowns).",
        hidden: true,
      },
      operation: { perform: performChannelList, sample: { id: "ch_sample", label: "Ocean Facts (youtube)" } },
    },
  },
  creates: {
    create_short: {
      key: "create_short",
      noun: "Short",
      display: {
        label: "Create Short",
        description:
          "Creates an original Short from a topic: script, voiceover, visuals and captions. Uses 1 Short credit.",
      },
      operation: {
        inputFields: createShortInputFields,
        perform: performCreateShort,
        sample: {
          id: "prj_sample",
          project_id: "prj_sample",
          job_id: "job_sample",
          status: "scripting",
          next: "Wait for the job, then review and approve the Short in ShortLoop.",
          app_url: "https://shortloop.example/projects/prj_sample",
        },
        outputFields: [
          { key: "id", label: "Short ID" },
          { key: "project_id", label: "Project ID" },
          { key: "job_id", label: "Job ID" },
          { key: "status", label: "Status" },
          { key: "next", label: "Next Step" },
          { key: "app_url", label: "Review Link" },
        ],
      },
    },
  },
};

export type ZapierApp = typeof zapierApp;
