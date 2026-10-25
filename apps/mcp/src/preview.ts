/**
 * The Short preview shown inside MCP Apps hosts (Claude, ChatGPT, VS Code, ...): a 9:16 player with the Short's
 * status, a "Check again" button while it renders, and "Open in ShortLoop". Hosts without MCP Apps ignore it and
 * still get the tool's text and structured result.
 */

export const PREVIEW_URI = "ui://shortloop/short-preview.html";
/** The MCP Apps resource type (`RESOURCE_MIME_TYPE` in @modelcontextprotocol/ext-apps). */
export const MCP_APP_MIME = "text/html;profile=mcp-app";
/** Pinned View SDK, loaded by the iframe; its origin is in the CSP below. */
export const EXT_APPS_URL =
  "https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";
const EXT_APPS_ORIGIN = new URL(EXT_APPS_URL).origin;

/** Origins the view may load from: the View SDK, plus where signed video/thumbnail links point. */
export function previewDomains(mediaOrigins: readonly string[]): string[] {
  return [...new Set([EXT_APPS_ORIGIN, ...mediaOrigins.filter(Boolean)])];
}

/** The `_meta` a tool carries so MCP Apps hosts render its result in the preview. */
export const previewToolMeta = { ui: { resourceUri: PREVIEW_URI } } as const;

/** The resource's `_meta`: CSP for the sandboxed iframe, and a border so it sits like a card. */
export const previewResourceMeta = (domains: string[]) => ({
  ui: { csp: { resourceDomains: domains }, prefersBorder: true },
});

/**
 * Self-contained HTML. It reads whatever the tool returned (get_short, create_short or a job view) and shows the
 * best it can: the video when there is one, otherwise progress. Text is set with textContent only (no HTML from
 * results), and links open through the host (`app.openLink`).
 */
export function previewHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ShortLoop preview</title>
<style>
  :root { color-scheme: light dark; --brand: #5b4cf0; --line: rgba(127,127,127,.25); --soft: rgba(127,127,127,.7); }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { display: flex; gap: 16px; padding: 14px; align-items: flex-start; flex-wrap: wrap; }
  .player { width: 220px; aspect-ratio: 9 / 16; border-radius: 12px; overflow: hidden; background: #0f1222;
    display: flex; align-items: center; justify-content: center; color: #fff; flex: none; }
  .player video, .player img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .info { flex: 1; min-width: 200px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    background: rgba(91,76,240,.12); color: var(--brand); }
  h1 { font-size: 16px; margin: 8px 0 4px; }
  p { margin: 4px 0; color: var(--soft); }
  .bar { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; margin: 10px 0; }
  .bar > div { height: 100%; background: var(--brand); width: 0; transition: width .4s; }
  .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  button { font: inherit; font-weight: 600; border-radius: 8px; padding: 7px 12px; cursor: pointer;
    border: 1px solid var(--line); background: transparent; color: inherit; }
  button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
  <div class="player" id="player"><span id="placeholder">Waiting for the Short…</span></div>
  <div class="info">
    <span class="badge" id="status">Loading</span>
    <h1 id="title">ShortLoop</h1>
    <p id="note"></p>
    <div class="bar" id="bar" hidden><div id="fill"></div></div>
    <div class="actions">
      <button id="refresh" hidden>Check again</button>
      <button class="primary" id="open" hidden>Open in ShortLoop</button>
    </div>
  </div>
</div>
<script type="module">
import { App } from "${EXT_APPS_URL}";
const $ = (id) => document.getElementById(id);
const LABEL = { scripting: "Writing script", producing: "Making video", ready: "Ready to review", approved: "Approved",
  failed: "Failed", published: "Published", scheduled: "Scheduled", queued: "Queued", uploading: "Uploading",
  scheduled_next_window: "Waiting for YouTube quota", draft: "Draft", script_ready: "Script ready" };
let state = {};
const app = new App({ name: "ShortLoop preview", version: "1.0.0" });

function render(data) {
  const job = data.job ?? data;
  state = {
    title: data.title ?? (data.script && data.script.title) ?? state.title ?? "Your Short",
    status: job.status ?? data.status ?? state.status,
    done: job.done ?? (data.video_url ? true : state.done),
    progress: typeof job.progress === "number" ? job.progress : state.progress,
    video: job.video_url ?? data.video_url ?? state.video,
    thumb: data.thumbnail_url ?? state.thumb,
    jobId: job.job_id ?? data.job_id ?? state.jobId,
    appUrl: data.app_url ?? state.appUrl,
    error: job.error ?? data.error,
    url: job.url,
  };
  $("title").textContent = state.title;
  $("status").textContent = LABEL[state.status] ?? state.status ?? "";
  $("note").textContent = state.error ? state.error
    : state.url ? "Live on YouTube."
    : state.status === "ready" ? "Watch it, then tell me to approve it or what to change."
    : state.done ? "" : "This takes a minute or two.";
  const busy = !state.done && !state.error;
  $("bar").hidden = !busy;
  $("fill").style.width = Math.round((state.progress ?? 0.05) * 100) + "%";
  $("refresh").hidden = !(busy && state.jobId);
  $("open").hidden = !state.appUrl;
  const player = $("player");
  if (state.video && !player.querySelector("video")) {
    const v = document.createElement("video");
    v.controls = true; v.playsInline = true; v.preload = "metadata";
    if (state.thumb) v.poster = state.thumb;
    v.src = state.video;
    player.replaceChildren(v);
  } else if (!state.video && state.thumb && !player.querySelector("img")) {
    const i = document.createElement("img"); i.alt = ""; i.src = state.thumb; player.replaceChildren(i);
  }
}

app.ontoolresult = (params) => {
  if (params && params.structuredContent) render(params.structuredContent);
};
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    const r = await app.callServerTool({ name: "wait_for_job", arguments: { job_id: state.jobId, timeout_seconds: 20 } });
    if (r && r.structuredContent) render(r.structuredContent);
  } finally { $("refresh").disabled = false; }
});
$("open").addEventListener("click", () => { if (state.appUrl) app.openLink({ url: state.appUrl }); });
await app.connect();
</script>
</body>
</html>
`;
}
