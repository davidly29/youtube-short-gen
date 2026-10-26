import { CAPTION_CHOICES, CREATE_SHORT_FIELDS, LENGTH_CHOICES } from "../fields";

/**
 * The ShortLoop custom app for Make (make.com), as the JSON blocks Make's app editor asks for (Base, Connection,
 * Webhook, Modules, RPCs). `pnpm -F integrations build:make` writes them to `apps/integrations/make/`; the README
 * there says which block goes where. Templates only use `{{path}}`, `{{omit(path; 'key')}}` and `{{!path}}` so the
 * tests can evaluate them (see `iml.ts`).
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export interface MakeParameter {
  name: string;
  label: string;
  type: "text" | "url" | "password" | "select" | "uinteger" | "boolean";
  required?: boolean;
  help: string;
  default?: Json;
  options?: { label: string; value: Json }[] | string;
}
export interface MakeModule {
  name: string;
  label: string;
  description: string;
  type: "action" | "trigger" | "instant_trigger";
  connection?: string;
  webhook?: string;
  parameters: MakeParameter[];
  expect: MakeParameter[];
  communication: { [k: string]: Json };
  interface: { name: string; label: string; type: string }[];
  samples: { [k: string]: Json };
}
export interface MakeApp {
  name: string;
  label: string;
  description: string;
  version: string;
  base: { [k: string]: Json };
  connection: {
    name: string;
    label: string;
    type: "basic";
    parameters: MakeParameter[];
    communication: { [k: string]: Json };
  };
  webhooks: {
    name: string;
    label: string;
    type: "dedicated";
    connection: string;
    attach: { [k: string]: Json };
    detach: { [k: string]: Json };
    communication: { [k: string]: Json };
  }[];
  rpcs: { name: string; label: string; communication: { [k: string]: Json } }[];
  modules: MakeModule[];
}

const CONNECTION = "shortloop";

const ERROR = {
  message: "[{{statusCode}}] {{body.error.message}}",
  type: "DataError",
  "401": {
    message: "ShortLoop didn't accept the API key. Create a new one in Settings → Developer.",
    type: "AccountValidationError",
  },
  "429": { message: "ShortLoop's rate limit was hit: {{body.error.message}}", type: "RateLimitError" },
} satisfies Json;

const SHORT_INTERFACE = [
  { name: "project_id", label: "Project ID", type: "text" },
  { name: "title", label: "Title", type: "text" },
  { name: "topic", label: "Topic", type: "text" },
  { name: "status", label: "Status", type: "text" },
  { name: "app_url", label: "Review link", type: "url" },
  { name: "video_url", label: "Video URL (expires in an hour)", type: "url" },
  { name: "thumbnail_url", label: "Thumbnail URL", type: "url" },
  { name: "publishable", label: "Ready to publish", type: "boolean" },
  { name: "problems", label: "Problems blocking publish", type: "array" },
];

const SHORT_SAMPLE = {
  project_id: "prj_sample",
  title: "Why octopuses have three hearts",
  topic: "why octopuses have three hearts",
  status: "ready",
  app_url: "https://shortloop.example/projects/prj_sample",
  video_url: "https://media.shortloop.example/prj_sample.mp4",
  thumbnail_url: "https://media.shortloop.example/prj_sample.jpg",
  publishable: true,
  problems: [],
};

const createShortExpect: MakeParameter[] = CREATE_SHORT_FIELDS.map((f): MakeParameter => {
  const base = { name: f.key, label: f.label, help: f.helpText, required: f.required ?? false };
  if (f.key === "length_seconds")
    return {
      ...base,
      type: "select",
      default: 45,
      options: LENGTH_CHOICES.map((c) => ({ label: c.label, value: Number(c.value) })),
    };
  if (f.key === "caption_style")
    return { ...base, type: "select", default: "bold-pop", options: CAPTION_CHOICES };
  if (f.key === "voice_id") return { ...base, type: "select", options: "rpc://listVoices" };
  if (f.key === "channel_voice_id") return { ...base, type: "select", options: "rpc://listChannels" };
  return { ...base, type: "text", ...(f.default ? { default: f.default } : {}) };
});

export const makeApp: MakeApp = {
  name: "shortloop",
  label: "ShortLoop",
  description: "Make original YouTube Shorts from trends: script, voice, rights-clean visuals and captions.",
  version: "1.0.0",
  base: {
    baseUrl: "{{connection.apiUrl}}",
    headers: { authorization: "Bearer {{connection.apiKey}}", accept: "application/json" },
    response: { error: ERROR },
    log: { sanitize: ["request.headers.authorization"] },
  },
  connection: {
    name: CONNECTION,
    label: "ShortLoop",
    type: "basic",
    parameters: [
      {
        name: "apiUrl",
        label: "API URL",
        type: "url",
        required: true,
        help: "Your ShortLoop address followed by /api/v1, e.g. https://app.shortloop.example/api/v1.",
      },
      {
        name: "apiKey",
        label: "API key",
        type: "password",
        required: true,
        help: "An sl_… key from ShortLoop → Settings → Developer → Create key. Scenarios act as you and use your credits.",
      },
    ],
    communication: {
      url: "{{parameters.apiUrl}}/account",
      headers: { authorization: "Bearer {{parameters.apiKey}}" },
      response: { metadata: { type: "text", value: "{{body.name}}" }, error: ERROR },
      log: { sanitize: ["request.headers.authorization"] },
    },
  },
  webhooks: [
    {
      name: "shortRendered",
      label: "Short rendered",
      type: "dedicated",
      connection: CONNECTION,
      attach: {
        url: "/webhooks",
        method: "POST",
        body: { url: "{{webhook.url}}", events: ["job.succeeded"] },
        response: { data: { externalHookId: "{{body.id}}" } },
      },
      detach: { url: "/webhooks/{{webhook.externalHookId}}", method: "DELETE" },
      communication: { output: "{{body.data}}" },
    },
  ],
  rpcs: [
    {
      name: "listVoices",
      label: "List voices",
      communication: {
        url: "/voices",
        response: { iterate: "{{body.voices}}", output: { label: "{{item.label}}", value: "{{item.id}}" } },
      },
    },
    {
      name: "listChannels",
      label: "List channels",
      communication: {
        url: "/account",
        response: {
          iterate: "{{body.channels}}",
          output: { label: "{{item.title}}", value: "{{item.channel_id}}" },
        },
      },
    },
  ],
  modules: [
    {
      name: "watchShortRendered",
      label: "Watch Rendered Shorts",
      description: "Triggers when a Short finishes rendering and is ready to review.",
      type: "instant_trigger",
      webhook: "shortRendered",
      parameters: [],
      expect: [],
      communication: { output: "{{body.data}}" },
      interface: [
        { name: "project_id", label: "Project ID", type: "text" },
        { name: "job_id", label: "Job ID", type: "text" },
        { name: "kind", label: "Job kind", type: "text" },
        { name: "status", label: "Status", type: "text" },
      ],
      samples: { project_id: "prj_sample", job_id: "job_sample", kind: "production", status: "ready" },
    },
    {
      name: "watchBriefIdeas",
      label: "Watch Brief Ideas",
      description: "Triggers when your daily trend brief has a new idea you haven't made yet.",
      type: "trigger",
      connection: CONNECTION,
      parameters: [
        {
          name: "limit",
          label: "Limit",
          type: "uinteger",
          required: true,
          default: 5,
          help: "The most ideas to return in one cycle.",
        },
        {
          name: "niche",
          label: "Niche",
          type: "text",
          help: "Only ideas for this niche, e.g. history or tech.",
        },
        {
          name: "channel_id",
          label: "Channel",
          type: "select",
          options: "rpc://listChannels",
          help: "Only ideas from this channel's brief.",
        },
      ],
      expect: [],
      communication: {
        url: "/trends",
        qs: "{{omit(parameters; 'limit')}}",
        response: {
          iterate: { container: "{{body.trends}}", condition: "{{!item.already_made}}" },
          output: "{{item}}",
          limit: "{{parameters.limit}}",
          trigger: { id: "{{item.topic_id}}", type: "id", order: "unordered" },
        },
      },
      interface: [
        { name: "topic_id", label: "Topic ID", type: "text" },
        { name: "topic", label: "Topic", type: "text" },
        { name: "angle", label: "Angle", type: "text" },
        { name: "hook", label: "Hook", type: "text" },
        { name: "format", label: "Format", type: "text" },
        { name: "why_now", label: "Why now", type: "text" },
        { name: "channel_id", label: "Channel ID", type: "text" },
        { name: "channel_title", label: "Channel", type: "text" },
        { name: "sources", label: "Sources", type: "array" },
      ],
      samples: {
        topic_id: "top_sample_octopus",
        topic: "Octopus intelligence study",
        angle: "What a new study says about how octopuses solve puzzles",
        hook: "Octopuses just solved a puzzle most toddlers can't.",
        format: "trend-explainer",
        why_now: "Search interest tripled in the last 24 hours.",
        channel_id: "ch_sample",
        channel_title: "Ocean Facts",
        sources: [{ title: "New octopus study", url: "https://news.example/octopus" }],
      },
    },
    {
      name: "createShort",
      label: "Create a Short",
      description:
        "Creates an original Short from a topic: script, voiceover, visuals and captions. Uses 1 Short credit.",
      type: "action",
      connection: CONNECTION,
      parameters: [],
      expect: createShortExpect,
      communication: {
        url: "/shorts",
        method: "POST",
        body: "{{parameters}}",
        response: { output: "{{body}}" },
      },
      interface: [
        { name: "project_id", label: "Project ID", type: "text" },
        { name: "job_id", label: "Job ID", type: "text" },
        { name: "status", label: "Status", type: "text" },
        { name: "next", label: "Next step", type: "text" },
        { name: "app_url", label: "Review link", type: "url" },
      ],
      samples: {
        project_id: "prj_sample",
        job_id: "job_sample",
        status: "scripting",
        next: "Wait for the job, then review and approve the Short in ShortLoop.",
        app_url: "https://shortloop.example/projects/prj_sample",
      },
    },
    {
      name: "getShort",
      label: "Get a Short",
      description: "Returns a Short's status, links and whether it is ready to publish.",
      type: "action",
      connection: CONNECTION,
      parameters: [],
      expect: [
        {
          name: "project_id",
          label: "Project ID",
          type: "text",
          required: true,
          help: "From Create a Short or Watch Rendered Shorts.",
        },
      ],
      communication: {
        url: "/shorts/{{parameters.project_id}}",
        method: "GET",
        response: { output: "{{body}}" },
      },
      interface: SHORT_INTERFACE,
      samples: SHORT_SAMPLE,
    },
  ],
};
