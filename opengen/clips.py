"""Find and cut short moments from your own long-form media."""
from __future__ import annotations

import re
from typing import Any

from . import captions, ff, store
from .config import ASPECTS

HOOK_PATTERNS = [
    r"\?$", r"^(why|how|what|when|who|imagine|here's|this is|the secret|nobody|never|stop|don't)\b",
    r"\b(\d+|first|biggest|worst|best|only|mistake|secret|truth|actually|crazy|insane)\b",
    r"\byou\b",
]
PAYOFF_PATTERNS = [r"\b(so|that's why|which means|the answer|turns out|because)\b", r"[.!]$"]


def _score_window(segs: list[dict[str, Any]]) -> tuple[float, list[str]]:
    first = segs[0]["text"].strip().lower()
    last = segs[-1]["text"].strip().lower()
    text = " ".join(s["text"] for s in segs)
    dur = segs[-1]["end"] - segs[0]["start"]
    words = len(text.split())
    reasons, score = [], 0.0
    hooks = sum(bool(re.search(p, first)) for p in HOOK_PATTERNS)
    if hooks:
        score += 1.5 * hooks
        reasons.append("hook-like opening")
    if any(re.search(p, last) for p in PAYOFF_PATTERNS):
        score += 1.0
        reasons.append("ends on a complete thought")
    wps = words / max(dur, 1)
    if 2.3 <= wps <= 3.6:
        score += 1.0
        reasons.append(f"good pace ({wps:.1f} words/s)")
    gaps = [b["start"] - a["end"] for a, b in zip(segs, segs[1:])]
    if gaps and max(gaps) > 1.5:
        score -= 1.0
        reasons.append("contains a long pause")
    return score, reasons


def find_clips(transcript: dict[str, Any], max_clips: int = 5, min_s: float = 15, max_s: float = 60) -> list[dict[str, Any]]:
    """Heuristic first pass: candidate windows made of whole segments, scored for hook/payoff/pace.

    The calling agent should read the returned text and re-rank: the heuristic only finds
    clean boundaries, the agent judges what is actually interesting.
    """
    segs = transcript["segments"]
    cands = []
    for i in range(len(segs)):
        for j in range(i, len(segs)):
            dur = segs[j]["end"] - segs[i]["start"]
            if dur > max_s:
                break
            if dur >= min_s:
                score, reasons = _score_window(segs[i:j + 1])
                cands.append({"start": segs[i]["start"], "end": segs[j]["end"], "duration": round(dur, 2),
                              "score": round(score, 2), "reasons": reasons,
                              "text": " ".join(s["text"] for s in segs[i:j + 1])})
    cands.sort(key=lambda c: (-c["score"], c["duration"]))
    picked: list[dict[str, Any]] = []
    for c in cands:
        if all(c["end"] <= p["start"] or c["start"] >= p["end"] for p in picked):
            picked.append(c)
        if len(picked) >= max_clips:
            break
    return sorted(picked, key=lambda c: c["start"])


def cut(media_id: str, start: float, end: float, aspect: str | None = "9:16", reframe: str = "crop",
        caption_style: str | None = None) -> dict[str, Any]:
    src = store.get_media(media_id)
    if end <= start:
        raise ValueError("end must be after start")
    out_id = store.new_id("vid")
    out = store.media_path(out_id, "mp4")
    vf = []
    w = h = None
    if aspect:
        w, h = ASPECTS[aspect]
        vf.append(ff.fit_filter(w, h, reframe))
    words: list[dict[str, Any]] = []
    if caption_style:
        all_words = src["meta"].get("transcript", {}).get("words")
        if not all_words:
            raise ValueError("Media has no transcript yet. Call transcribe_media first.")
        words = [{**x, "start": x["start"] - start, "end": x["end"] - start} for x in all_words if start <= x["start"] < end]
        info = ff.probe(src["path"])
        cw, ch = (w, h) if w else (info["width"], info["height"])
        ass = captions.write_ass(words, cw, ch, caption_style, store.settings.work_dir / f"{out_id}.ass")
        vf.append(captions.ass_filter(ass))
    args = ["-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", src["path"]]
    if vf:
        args += ["-vf", ",".join(vf)]
    ff.run([*args, *ff.ENCODE_V, *ff.ENCODE_A, "-movflags", "+faststart", str(out)])
    info = ff.probe(out)
    return store.add_media(out, "video", source="derived", licence={"type": "derived", "from": media_id},
                           meta={**info, "from": media_id, "start": start, "end": end, "words": words},
                           media_id=out_id)
