"""Video clip generation.

Providers
- kenburns: free and local. Animates a still image (given, or generated with the image provider)
            with a slow zoom/pan. Good enough to learn the pipeline.
- fal:      FAL_KEY. Calls a fal.ai text-to-video or image-to-video model (Kling, Seedance, etc.)
            through fal's queue API. Model ids are set in OPENGEN_FAL_T2V_MODEL / OPENGEN_FAL_I2V_MODEL.
"""
from __future__ import annotations

import base64
import mimetypes
import random
import time
from pathlib import Path
from typing import Any

import httpx

from . import ff, images, store
from .config import ASPECTS, FPS, settings

MOTIONS = ("zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down")


def kenburns(image_path: str | Path, out: Path, duration: float, aspect: str, motion: str = "zoom_in") -> None:
    w, h = ASPECTS.get(aspect, ASPECTS["9:16"])
    frames = max(1, int(duration * FPS))
    # Oversample to avoid zoompan jitter, then cover-crop to target.
    big_w, big_h = w * 2, h * 2
    z = {
        "zoom_in": ("min(1+0.0015*on,1.25)", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
        "zoom_out": (f"max(1.25-0.0015*on,1)", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
        "pan_left": ("1.15", f"(iw-iw/zoom)*(1-on/{frames})", "ih/2-(ih/zoom/2)"),
        "pan_right": ("1.15", f"(iw-iw/zoom)*on/{frames}", "ih/2-(ih/zoom/2)"),
        "pan_up": ("1.15", "iw/2-(iw/zoom/2)", f"(ih-ih/zoom)*(1-on/{frames})"),
        "pan_down": ("1.15", "iw/2-(iw/zoom/2)", f"(ih-ih/zoom)*on/{frames}"),
    }[motion if motion in MOTIONS else "zoom_in"]
    vf = (
        f"scale={big_w}:{big_h}:force_original_aspect_ratio=increase,crop={big_w}:{big_h},"
        f"zoompan=z='{z[0]}':x='{z[1]}':y='{z[2]}':d={frames}:s={w}x{h}:fps={FPS},setsar=1"
    )
    ff.run(["-loop", "1", "-i", str(image_path), "-vf", vf, "-frames:v", str(frames), *ff.ENCODE_V, "-an", str(out)])


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _fal_queue(model: str, body: dict[str, Any], timeout_s: int = 900) -> dict[str, Any]:
    if not settings.fal_key:
        raise RuntimeError("FAL_KEY is not set")
    headers = {"Authorization": f"Key {settings.fal_key}"}
    r = httpx.post(f"https://queue.fal.run/{model}", json=body, headers=headers, timeout=60)
    r.raise_for_status()
    sub = r.json()
    status_url, response_url = sub["status_url"], sub["response_url"]
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = httpx.get(status_url, headers=headers, timeout=30).json()
        if s.get("status") == "COMPLETED":
            res = httpx.get(response_url, headers=headers, timeout=60)
            res.raise_for_status()
            return res.json()
        if s.get("status") in {"FAILED", "ERROR"}:
            raise RuntimeError(f"fal job failed: {s}")
        time.sleep(4)
    raise TimeoutError("fal video generation timed out")


def generate(
    prompt: str = "",
    image_media_id: str | None = None,
    duration: float = 5.0,
    aspect: str = "9:16",
    provider: str | None = None,
    motion: str = "zoom_in",
    style: str = "none",
) -> dict[str, Any]:
    provider = (provider or settings.video_provider).lower()
    media_id = store.new_id("vid")
    out = store.media_path(media_id, "mp4")

    if provider == "kenburns":
        if image_media_id:
            src = store.get_media(image_media_id)["path"]
        elif prompt:
            src = images.generate(prompt, aspect=aspect, style=style)["path"]
        else:
            raise ValueError("kenburns needs prompt or image_media_id")
        kenburns(src, out, duration, aspect, motion)
    elif provider == "fal":
        body: dict[str, Any] = {"prompt": prompt or "subtle natural motion", "aspect_ratio": aspect,
                                "duration": "10" if duration > 7 else "5"}
        if image_media_id:
            body["image_url"] = _data_uri(Path(store.get_media(image_media_id)["path"]))
            model = settings.fal_i2v_model
        else:
            model = settings.fal_t2v_model
        res = _fal_queue(model, body)
        url = (res.get("video") or {}).get("url") or res["videos"][0]["url"]
        out.write_bytes(httpx.get(url, timeout=300).content)
        duration = ff.probe(out)["duration"]
    else:
        raise ValueError(f"Unknown video provider '{provider}'. Use kenburns or fal.")

    store.log_usage(provider, "video", duration, "seconds")
    info = ff.probe(out)
    return store.add_media(
        out, "video", source="ai_generated",
        licence={"type": "ai_generated", "provider": provider, "prompt": prompt},
        meta={**info, "prompt": prompt, "aspect": aspect, "motion": motion if provider == "kenburns" else None},
        media_id=media_id,
    )


def random_motion(i: int) -> str:
    return random.Random(i).choice(MOTIONS)
