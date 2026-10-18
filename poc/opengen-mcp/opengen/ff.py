"""Thin wrappers around ffmpeg / ffprobe."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .config import FPS


class FFmpegError(RuntimeError):
    pass


def require() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise FFmpegError(f"'{tool}' not found on PATH. Install FFmpeg (with libass) first.")


def run(args: list[str], timeout: int = 1800) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise FFmpegError(f"ffmpeg failed: {proc.stderr.strip()[-1500:]}")


def probe(path: str | Path) -> dict[str, Any]:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise FFmpegError(f"ffprobe failed on {path}: {proc.stderr.strip()}")
    data = json.loads(proc.stdout)
    v = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    duration = float(data["format"].get("duration") or (v or {}).get("duration") or 0)
    is_image = v is not None and (duration == 0 or v.get("codec_name") in {"png", "mjpeg", "webp", "bmp"}) and a is None
    return {
        "duration": round(duration, 3),
        "width": int(v["width"]) if v else None,
        "height": int(v["height"]) if v else None,
        "has_video": v is not None and not is_image,
        "has_audio": a is not None,
        "is_image": is_image,
    }


def kind_of(path: str | Path) -> str:
    info = probe(path)
    if info["is_image"]:
        return "image"
    if info["has_video"]:
        return "video"
    if info["has_audio"]:
        return "audio"
    raise FFmpegError(f"{path} has no audio, video or image stream")


ENCODE_V = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS)]
ENCODE_A = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]


def fit_filter(w: int, h: int, mode: str = "crop") -> str:
    """Video filter that fits any input into WxH.

    crop: scale to cover, centre-crop (fills frame, may cut edges)
    blur: scale to fit over a blurred, zoomed copy of itself (keeps whole frame)
    pad:  scale to fit, black bars
    """
    if mode == "crop":
        return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    if mode == "pad":
        return f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    if mode == "blur":
        return (
            f"split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},gblur=sigma=30[bg];"
            f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1"
        )
    raise ValueError("reframe mode must be crop, blur or pad")
