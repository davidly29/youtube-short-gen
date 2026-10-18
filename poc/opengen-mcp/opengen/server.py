"""OpenGen MCP: a local, self-hosted short-form video MCP server for learning how
Everygen-style tools work. Claude (or any MCP client) is the director; this server is the
media engine. Defaults are free and run locally; paid providers are optional.
"""
from __future__ import annotations

import argparse
import os
import re
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.fastmcp import FastMCP, Image
from pydantic import BaseModel, Field

from . import captions, clips, compose, ff, images, store, transcribe, tts, video_gen
from .config import ASPECTS, settings

WORKFLOW_DIR = Path(__file__).parent / "workflows"
BLOCKED_HOSTS = ("youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "fb.watch",
                 "twitter.com", "x.com", "twitch.tv", "vimeo.com")

Aspect = Literal["9:16", "16:9", "1:1", "4:5"]
Reframe = Literal["crop", "blur", "pad"]
CaptionStyle = Literal["bold", "karaoke", "pop", "boxed", "minimal", "neon", "none"]

mcp = FastMCP(
    "opengen",
    instructions=(
        "Local short-form video studio. You (the assistant) write scripts and direct; tools render. "
        "Start with list_workflows / get_workflow for a format playbook. Typical flow: write narration + "
        "image prompts per scene -> estimate_cost -> compose_video -> wait_for_job -> preview_media. "
        "Only use media the user owns or generated media. Long tasks return a job_id; poll with wait_for_job."
    ),
    host="127.0.0.1",
    port=8765,
)


# ------------------------------------------------------------------ helpers
def _run_job(job_type: str, payload: dict[str, Any], fn) -> dict[str, Any]:
    job_id = store.create_job(job_type, payload)

    def progress(p: float, msg: str) -> None:
        store.update_job(job_id, progress=p, message=msg)

    def worker() -> None:
        store.update_job(job_id, status="running", message="started")
        try:
            out = fn(job_id, progress)
            store.update_job(job_id, status="succeeded", progress=1.0, message="done", output=out)
        except Exception as e:  # noqa: BLE001 - surface any failure to the agent
            store.update_job(job_id, status="failed", error=f"{type(e).__name__}: {e}")

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": "queued", "next": "Call wait_for_job with this job_id."}


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        for line in fm.strip().splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
        return meta, body
    return meta, text


# ------------------------------------------------------------------ playbooks
@mcp.tool()
def list_workflows() -> list[dict[str, str]]:
    """List the video format playbooks (faceless story, animal story, ranking clip, 3D explainer, ...).
    Free. Call get_workflow to read one before starting."""
    out = []
    for p in sorted(WORKFLOW_DIR.glob("*.md")):
        meta, _ = _parse_frontmatter(p.read_text())
        out.append({"slug": p.stem, "title": meta.get("title", p.stem), "summary": meta.get("summary", "")})
    return out


@mcp.tool()
def get_workflow(slug: str, phase: Literal["all", "start", "script", "visuals", "publish"] = "all") -> str:
    """Read a format playbook, whole or one phase at a time (start -> script -> visuals -> publish)."""
    path = WORKFLOW_DIR / f"{slug}.md"
    if not path.is_file():
        raise ValueError(f"No workflow '{slug}'. Call list_workflows.")
    meta, body = _parse_frontmatter(path.read_text())
    if phase == "all":
        return f"# {meta.get('title', slug)}\n{body}"
    m = re.search(rf"^## {phase}\n(.*?)(?=^## |\Z)", body, re.S | re.M)
    return m.group(1).strip() if m else f"No '{phase}' phase in {slug}."


@mcp.tool()
def list_options() -> dict[str, Any]:
    """Voices, caption styles, visual style presets, aspect ratios, motions and which providers are configured."""
    return {
        "voices": {"edge (free)": tts.EDGE_VOICES, "openai": tts.OPENAI_VOICES,
                   "elevenlabs": "any ElevenLabs voice_id from your account"},
        "caption_styles": {k: v["desc"] for k, v in captions.STYLES.items()},
        "visual_styles": images.STYLE_PRESETS,
        "aspect_ratios": {k: f"{w}x{h}" for k, (w, h) in ASPECTS.items()},
        "kenburns_motions": list(video_gen.MOTIONS),
        "defaults": {"tts": settings.tts_provider, "image": settings.image_provider, "video": settings.video_provider},
        "configured_paid_providers": {"elevenlabs": bool(settings.elevenlabs_key), "fal": bool(settings.fal_key),
                                      "openai": bool(settings.openai_key)},
    }


# ------------------------------------------------------------------ media in / out
@mcp.tool()
def import_media(path_or_url: str, owned_or_licensed: bool) -> dict[str, Any]:
    """Add a video, image or audio file you own (local path or direct https link to the file).
    Set owned_or_licensed=true to confirm you have the rights. Links to YouTube, TikTok, Instagram
    and similar platforms are refused: download your own uploads from the platform's studio first."""
    if not owned_or_licensed:
        raise ValueError("Only import media you own or have a licence for (set owned_or_licensed=true).")
    if re.match(r"https?://", path_or_url):
        host = urllib.parse.urlparse(path_or_url).hostname or ""
        if any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS):
            raise ValueError(f"Downloading from {host} is not supported. Export your own video from the platform and import the file.")
        suffix = Path(urllib.parse.urlparse(path_or_url).path).suffix or ".bin"
        fd, tmp_name = tempfile.mkstemp(suffix=suffix, dir=settings.work_dir)
        os.close(fd)  # Windows can't delete a file that still has an open handle
        tmp = Path(tmp_name)
        with httpx.stream("GET", path_or_url, follow_redirects=True, timeout=300) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        src, source = tmp, "url"
    else:
        src, source = Path(path_or_url).expanduser(), "upload"
        if not src.is_file():
            raise FileNotFoundError(f"No file at {src}")
    kind = ff.kind_of(src)
    info = ff.probe(src)
    item = store.add_media(src, kind, source=source, licence={"type": "owned", "attested": True, "origin": path_or_url},
                           meta={**info, "original_name": Path(path_or_url).name})
    if source == "url":
        src.unlink(missing_ok=True)
    return item


@mcp.tool()
def list_media(kind: Literal["video", "image", "audio"] | None = None, limit: int = 30) -> list[dict[str, Any]]:
    """List media in the local library, newest first (imported, generated and rendered)."""
    rows = store.list_media(kind, limit)
    for r in rows:  # keep responses small
        r["meta"] = {k: v for k, v in r["meta"].items() if k not in {"words", "spec", "transcript"}}
    return rows


@mcp.tool()
def preview_media(media_id: str, at_seconds: float = 1.0, max_width: int = 360) -> Image:
    """Return a still frame so you can look at a render or image before handing it to the user."""
    m = store.get_media(media_id)
    out = settings.work_dir / f"preview_{media_id}_{int(at_seconds * 1000)}.jpg"
    if m["kind"] == "image":
        ff.run(["-i", m["path"], "-vf", f"scale={max_width}:-2", str(out)])
    elif m["kind"] == "video":
        ff.run(["-ss", f"{at_seconds:.3f}", "-i", m["path"], "-frames:v", "1", "-vf", f"scale={max_width}:-2", str(out)])
    else:
        raise ValueError("Audio has no picture to preview.")
    return Image(path=str(out))


# ------------------------------------------------------------------ generation
@mcp.tool()
def generate_voiceover(text: str, voice: str | None = None,
                       provider: Literal["edge", "elevenlabs", "openai", "offline"] | None = None,
                       speed: float = 1.0) -> dict[str, Any]:
    """Text to speech. Returns an audio media item with word-level timings (used for captions).
    edge is free; elevenlabs/openai need API keys; offline makes silence for testing."""
    item = tts.synthesize(text, voice, provider, speed)
    item["meta"]["word_count"] = len(item["meta"].pop("words"))
    return item


@mcp.tool()
def generate_image(prompt: str, aspect_ratio: Aspect = "9:16", style: str = "none",
                   provider: Literal["pollinations", "fal", "openai", "card"] | None = None,
                   seed: int | None = None) -> dict[str, Any]:
    """Generate one image. style is a preset from list_options (photoreal, cinematic, 3d, hand-drawn,
    whiteboard, storyboard, anime) or free text. 'card' draws an offline title card."""
    return images.generate(prompt, aspect_ratio, style, provider, seed)


@mcp.tool()
def generate_video(prompt: str = "", image_media_id: str | None = None, duration_seconds: float = 5.0,
                   aspect_ratio: Aspect = "9:16", provider: Literal["kenburns", "fal"] | None = None,
                   motion: str = "zoom_in", style: str = "none") -> dict[str, Any]:
    """Generate a short video clip as a background job. kenburns (free) animates an image;
    fal (FAL_KEY) runs a text/image-to-video model such as Kling or Seedance. Returns a job_id."""
    return _run_job("generate_video", {"prompt": prompt}, lambda jid, prog: video_gen.generate(
        prompt, image_media_id, duration_seconds, aspect_ratio, provider, motion, style))


# ------------------------------------------------------------------ editing own footage
@mcp.tool()
def transcribe_media(media_id: str, language: str | None = None) -> dict[str, Any]:
    """Transcribe a video/audio item locally with Whisper (word timestamps). Runs as a job; the
    transcript is saved on the media item for find_clips, cut_clip and add_captions."""
    def run(_jid, prog):
        m = store.get_media(media_id)
        prog(0.1, "transcribing")
        tr = transcribe.transcribe(m["path"], language)
        meta = {**m["meta"], "transcript": tr}
        store.add_media(Path(m["path"]), m["kind"], m["source"], m["licence"], meta, media_id=media_id)
        return {"media_id": media_id, "language": tr["language"], "duration": tr["duration"],
                "segments": tr["segments"], "word_count": len(tr["words"])}
    return _run_job("transcribe", {"media_id": media_id}, run)


@mcp.tool()
def find_clips(media_id: str, max_clips: int = 5, min_seconds: float = 15, max_seconds: float = 60) -> list[dict[str, Any]]:
    """Suggest short moments from a transcribed long video. Heuristic first pass: read each
    candidate's text and re-rank them yourself before cutting."""
    tr = store.get_media(media_id)["meta"].get("transcript")
    if not tr:
        raise ValueError("Run transcribe_media first.")
    return clips.find_clips(tr, max_clips, min_seconds, max_seconds)


@mcp.tool()
def cut_clip(media_id: str, start_seconds: float, end_seconds: float, aspect_ratio: Aspect | None = "9:16",
             reframe: Reframe = "crop", caption_style: CaptionStyle = "none") -> dict[str, Any]:
    """Cut a moment from your own video, optionally reframe to vertical and burn captions
    (captions need transcribe_media first)."""
    return clips.cut(media_id, start_seconds, end_seconds, aspect_ratio, reframe,
                     None if caption_style == "none" else caption_style)


@mcp.tool()
def reframe_video(media_id: str, aspect_ratio: Aspect = "9:16", mode: Reframe = "blur") -> dict[str, Any]:
    """Convert a video to another aspect ratio. crop fills the frame (centre crop),
    blur keeps the whole frame over a blurred background, pad adds black bars."""
    m = store.get_media(media_id)
    w, h = ASPECTS[aspect_ratio]
    out_id = store.new_id("vid")
    out = store.media_path(out_id, "mp4")
    ff.run(["-i", m["path"], "-vf", ff.fit_filter(w, h, mode), *ff.ENCODE_V, *ff.ENCODE_A, "-movflags", "+faststart", str(out)])
    return store.add_media(out, "video", "derived", {"type": "derived", "from": media_id},
                           {**ff.probe(out), "from": media_id, "reframe": mode}, media_id=out_id)


@mcp.tool()
def add_captions(media_id: str, style: CaptionStyle = "bold") -> dict[str, Any]:
    """Burn animated captions into a video. Uses word timings saved by transcribe_media, or the
    narration timings of a video made by compose_video / cut_clip."""
    m = store.get_media(media_id)
    words = m["meta"].get("words") or (m["meta"].get("transcript") or {}).get("words")
    if not words:
        raise ValueError("No word timings on this video. Run transcribe_media first.")
    info = ff.probe(m["path"])
    out_id = store.new_id("vid")
    out = store.media_path(out_id, "mp4")
    ass = captions.write_ass(words, info["width"], info["height"], style, settings.work_dir / f"{out_id}.ass")
    ff.run(["-i", m["path"], "-vf", captions.ass_filter(ass), *ff.ENCODE_V, "-c:a", "copy", "-movflags", "+faststart", str(out)])
    return store.add_media(out, "video", "derived", {"type": "derived", "from": media_id},
                           {**ff.probe(out), "from": media_id, "caption_style": style}, media_id=out_id)


# ------------------------------------------------------------------ compose
class Scene(BaseModel):
    narration: str = Field("", description="What the voice says during this scene. Scene length follows it.")
    image_prompt: str | None = Field(None, description="Generate an image for this scene (animated with Ken Burns).")
    video_prompt: str | None = Field(None, description="Generate a video clip for this scene (uses the video provider).")
    media_id: str | None = Field(None, description="Use an existing image/video from the library instead.")
    start: float = Field(0, description="For media_id videos: where to start inside the source, seconds.")
    duration: float | None = Field(None, description="Length for scenes without narration, seconds (default 3).")
    min_duration: float | None = Field(None, description="Hold the scene at least this long.")
    motion: str | None = Field(None, description="Ken Burns motion for images: zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down.")
    style: str | None = Field(None, description="Override the visual style preset for this scene.")
    image_provider: str | None = None
    video_provider: str | None = None
    reframe: Reframe = "crop"


class Voice(BaseModel):
    provider: Literal["edge", "elevenlabs", "openai", "offline"] | None = None
    voice: str | None = Field(None, description="Voice id from list_options (edge) or your ElevenLabs voice_id.")
    speed: float = 1.0


class Music(BaseModel):
    media_id: str = Field(description="An audio item you imported (royalty-free or your own).")
    volume_db: float = -18


@mcp.tool()
def compose_video(scenes: list[Scene], aspect_ratio: Aspect = "9:16", voice: Voice | None = None,
                  caption_style: CaptionStyle = "bold", style: str = "none", music: Music | None = None,
                  title: str | None = None, image_provider: str | None = None,
                  video_provider: str | None = None) -> dict[str, Any]:
    """Build a finished video from scenes: narrates each scene, generates or reuses its visual,
    times visuals to the voice, adds animated captions and optional ducked music. Max 180 s.
    Runs as a background job: returns job_id; call wait_for_job."""
    spec = {
        "scenes": [s.model_dump(exclude_none=True) for s in scenes], "aspect_ratio": aspect_ratio,
        "voice": voice.model_dump(exclude_none=True) if voice else {}, "caption_style": caption_style,
        "style": style, "music": music.model_dump() if music else None, "title": title,
        "image_provider": image_provider, "video_provider": video_provider,
    }
    return _run_job("compose_video", {"title": title, "scenes": len(scenes)},
                    lambda jid, prog: compose.compose(jid, spec, prog))


# ------------------------------------------------------------------ jobs, cost, usage
@mcp.tool()
def get_job(job_id: str) -> dict[str, Any]:
    """Status, progress and result of a background job."""
    return store.get_job(job_id)


@mcp.tool()
def wait_for_job(job_id: str, timeout_seconds: float = 50) -> dict[str, Any]:
    """Wait (up to 55 s per call) for a job to finish. Call again if it is still running."""
    deadline = time.time() + min(timeout_seconds, 55)
    while True:
        job = store.get_job(job_id)
        if job["status"] in {"succeeded", "failed"} or time.time() >= deadline:
            return job
        time.sleep(1.0)


@mcp.tool()
def estimate_cost(scenes: list[Scene], voice: Voice | None = None, image_provider: str | None = None,
                  video_provider: str | None = None) -> dict[str, Any]:
    """Before composing: count the external calls a plan will make, flagging which ones cost money,
    and estimate the video length from the narration (~2.6 words/s)."""
    tts_p = (voice.provider if voice and voice.provider else settings.tts_provider)
    img_p = image_provider or settings.image_provider
    vid_p = video_provider or settings.video_provider
    chars = sum(len(s.narration) for s in scenes)
    words = sum(len(s.narration.split()) for s in scenes)
    n_img = sum(1 for s in scenes if s.image_prompt and not s.media_id and not s.video_prompt)
    n_vid = sum(1 for s in scenes if s.video_prompt and not s.media_id)
    est_s = words / 2.6 + sum((s.duration or 3) for s in scenes if not s.narration.strip())
    calls = [{"provider": tts_p, "operation": "voiceover", "units": chars, "unit": "chars",
              "paid": tts_p in store.PAID_PROVIDERS}]
    if n_img:
        calls.append({"provider": img_p, "operation": "image", "units": n_img, "unit": "images", "paid": img_p in store.PAID_PROVIDERS})
    if n_vid:
        calls.append({"provider": vid_p, "operation": "video", "units": n_vid, "unit": "clips", "paid": vid_p in store.PAID_PROVIDERS})
    return {"estimated_length_s": round(est_s, 1), "within_180s_limit": est_s <= 180, "calls": calls,
            "note": "Free providers cost nothing; paid ones bill your own API account at their published rates."}


@mcp.tool()
def get_usage(days: int = 30) -> list[dict[str, Any]]:
    """What this server has called over the last N days, grouped by provider (paid=1 means it hit a paid API)."""
    return store.usage_summary(days)


# ------------------------------------------------------------------ file serving (HTTP mode)
@mcp.custom_route("/files/{name}", methods=["GET"])
async def serve_file(request):  # pragma: no cover - exercised manually
    from starlette.responses import FileResponse, PlainTextResponse

    name = Path(request.path_params["name"]).name
    path = settings.media_dir / name
    if not path.is_file():
        return PlainTextResponse("not found", status_code=404)
    return FileResponse(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenGen MCP server")
    parser.add_argument("--http", action="store_true", help="Serve Streamable HTTP on /mcp instead of stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    ff.require()
    if args.http:
        mcp.settings.host, mcp.settings.port = args.host, args.port
        mcp.run(transport="streamable-http")
    else:
        mcp.run()


if __name__ == "__main__":
    main()
