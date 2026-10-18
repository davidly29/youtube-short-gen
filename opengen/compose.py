"""compose_video: scenes + narration + captions + music -> one finished Short.

Each scene is timed to its own narration so visuals change exactly when the voice moves on.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from . import captions, ff, images, store, tts, video_gen
from .config import ASPECTS, MAX_VIDEO_SECONDS, settings

Progress = Callable[[float, str], None]


def _scene_visual(scene: dict[str, Any], idx: int, dur: float, aspect: str, defaults: dict[str, Any]) -> Path:
    """Return a silent video file exactly `dur` seconds long, WxH, for this scene."""
    w, h = ASPECTS[aspect]
    out = settings.work_dir / f"{defaults['job']}_scene{idx}_v.mp4"
    motion = scene.get("motion") or video_gen.random_motion(idx)
    reframe = scene.get("reframe", "crop")

    media_id = scene.get("media_id")
    if not media_id and scene.get("video_prompt"):
        media_id = video_gen.generate(scene["video_prompt"], duration=dur, aspect=aspect,
                                      provider=scene.get("video_provider") or defaults.get("video_provider"),
                                      style=scene.get("style") or defaults.get("style", "none"))["id"]
    if not media_id and scene.get("image_prompt"):
        media_id = images.generate(scene["image_prompt"], aspect=aspect,
                                   style=scene.get("style") or defaults.get("style", "none"),
                                   provider=scene.get("image_provider") or defaults.get("image_provider"))["id"]
    if not media_id:
        raise ValueError(f"Scene {idx}: give media_id, image_prompt or video_prompt")

    src = store.get_media(media_id)
    if src["kind"] == "image":
        video_gen.kenburns(src["path"], out, dur, aspect, motion)
        return out
    if src["kind"] != "video":
        raise ValueError(f"Scene {idx}: media {media_id} is {src['kind']}, need image or video")
    start = float(scene.get("start", 0))
    # Loop short clips so they always cover the narration.
    ff.run(["-stream_loop", "-1", "-ss", f"{start:.3f}", "-i", src["path"], "-t", f"{dur:.3f}",
            "-vf", ff.fit_filter(w, h, reframe), *ff.ENCODE_V, "-an", str(out)])
    return out


def compose(job_id: str, spec: dict[str, Any], progress: Progress) -> dict[str, Any]:
    aspect = spec.get("aspect_ratio", "9:16")
    if aspect not in ASPECTS:
        raise ValueError(f"aspect_ratio must be one of {list(ASPECTS)}")
    w, h = ASPECTS[aspect]
    scenes = spec["scenes"]
    if not scenes:
        raise ValueError("scenes is empty")
    voice = spec.get("voice") or {}
    caption_style = spec.get("caption_style", "bold")
    defaults = {"job": job_id, "style": spec.get("style", "none"),
                "image_provider": spec.get("image_provider"), "video_provider": spec.get("video_provider")}
    pad = float(spec.get("scene_pad_s", 0.15))

    parts: list[Path] = []
    all_words: list[dict[str, Any]] = []
    t = 0.0
    n = len(scenes)
    for i, scene in enumerate(scenes):
        progress(0.05 + 0.75 * i / n, f"scene {i + 1}/{n}")
        narration = (scene.get("narration") or "").strip()
        audio_path = None
        if narration:
            aud = tts.synthesize(narration, voice=voice.get("voice"), provider=voice.get("provider"),
                                 speed=float(voice.get("speed", 1.0)))
            audio_path = aud["path"]
            dur = aud["meta"]["duration"] + pad
            all_words += [{**wd, "start": wd["start"] + t, "end": wd["end"] + t} for wd in aud["meta"]["words"]]
        else:
            dur = float(scene.get("duration", 3.0))
        if scene.get("min_duration"):
            dur = max(dur, float(scene["min_duration"]))
        if t + dur > MAX_VIDEO_SECONDS:
            raise ValueError(f"Video would exceed {MAX_VIDEO_SECONDS:.0f}s; shorten the narration or drop scenes.")

        vis = _scene_visual(scene, i, dur, aspect, defaults)
        part = settings.work_dir / f"{job_id}_scene{i}.mp4"
        if audio_path:
            ff.run(["-i", str(vis), "-i", audio_path, "-filter_complex", f"[1:a]apad=whole_dur={dur:.3f}[a]",
                    "-map", "0:v", "-map", "[a]", "-t", f"{dur:.3f}", "-c:v", "copy", *ff.ENCODE_A, str(part)])
        else:
            ff.run(["-i", str(vis), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{dur:.3f}",
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", *ff.ENCODE_A, str(part)])
        parts.append(part)
        t += dur

    progress(0.82, "joining scenes")
    concat_list = settings.work_dir / f"{job_id}_concat.txt"
    concat_list.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
    joined = settings.work_dir / f"{job_id}_joined.mp4"
    ff.run(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined)])

    out_id = store.new_id("vid")
    out = store.media_path(out_id, "mp4")
    inputs = ["-i", str(joined)]
    vchain = "[0:v]null[v0]"
    if caption_style and caption_style != "none" and all_words:
        ass = captions.write_ass(all_words, w, h, caption_style, settings.work_dir / f"{job_id}.ass")
        vchain = f"[0:v]{captions.ass_filter(ass)}[v0]"
    achain = "[0:a]anull[a0]"
    music = spec.get("music") or {}
    if music.get("media_id"):
        m = store.get_media(music["media_id"])
        vol = float(music.get("volume_db", -18))
        inputs += ["-stream_loop", "-1", "-i", m["path"]]
        # Duck music under speech with a sidechain compressor.
        achain = (f"[1:a]volume={vol}dB,atrim=0:{t:.3f}[m];[0:a]asplit[s1][s2];"
                  f"[m][s1]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[md];"
                  f"[s2][md]amix=inputs=2:duration=first:normalize=0[a0]")
    progress(0.88, "captions, music and final encode")
    ff.run([*inputs, "-filter_complex", f"{vchain};{achain}", "-map", "[v0]", "-map", "[a0]",
            "-t", f"{t:.3f}", *ff.ENCODE_V, *ff.ENCODE_A, "-movflags", "+faststart", str(out)])

    for p in [*parts, joined, concat_list]:
        p.unlink(missing_ok=True)
    info = ff.probe(out)
    store.log_usage("local", "render", info["duration"], "seconds")
    result = store.add_media(
        out, "video", source="composed",
        licence={"type": "composed", "inputs": "see meta.spec"},
        meta={**info, "spec": spec, "words": all_words, "title": spec.get("title")},
        media_id=out_id,
    )
    progress(1.0, "done")
    return result
