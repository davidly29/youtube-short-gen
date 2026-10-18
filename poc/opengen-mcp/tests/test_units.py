"""Unit tests for pure logic and the own-footage path (no network, no Whisper model download)."""
from __future__ import annotations

import os
import tempfile

os.environ.setdefault("OPENGEN_HOME", tempfile.mkdtemp())

from pathlib import Path  # noqa: E402

from opengen import captions, clips, ff, store, tts  # noqa: E402


def _transcript():
    texts = [
        "Why does nobody talk about this mistake?",
        "Most people start by buying gear.",
        "They spend months comparing cameras.",
        "But the camera is not the problem.",
        "The problem is the first three seconds of every video.",
        "So that's why your hook matters more than your lens.",
        "Okay, moving on to sponsors.",
        "Our sponsor today makes great coffee.",
    ]
    segs, words, t = [], [], 0.0
    for tx in texts:
        start = t
        for w in tx.split():
            words.append({"text": w, "start": round(t, 2), "end": round(t + 0.3, 2)})
            t += 0.38
        segs.append({"start": round(start, 2), "end": round(t, 2), "text": tx})
        t += 0.2
    return {"segments": segs, "words": words, "language": "en", "duration": t}


def test_estimate_words_monotonic():
    ws = tts.estimate_words("Hello there, this is a test. Another sentence!", 4.0)
    assert len(ws) == 8
    assert all(a["end"] <= b["start"] + 1e-6 for a, b in zip(ws, ws[1:]))
    assert ws[-1]["end"] <= 4.0


def test_caption_pages_break_on_punctuation():
    ws = tts.estimate_words("One two. Three four five six seven", 3.0)
    pages = captions.pages(ws, 3)
    assert [len(p) for p in pages] == [2, 3, 2]


def test_build_ass_all_styles():
    ws = tts.estimate_words("Captions should render in every style", 3.0)
    for style in captions.STYLES:
        ass = captions.build_ass(ws, 1080, 1920, style)
        assert "Dialogue:" in ass and "PlayResY: 1920" in ass


def test_find_clips_prefers_hook_and_avoids_sponsor():
    found = clips.find_clips(_transcript(), max_clips=1, min_s=8, max_s=20)
    assert found and found[0]["text"].startswith("Why does nobody")
    assert "sponsor" not in found[0]["text"].lower()


def test_cut_clip_with_captions():
    src = Path(store.settings.work_dir) / "src.mp4"
    ff.run(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=300",
            "-t", "20", *ff.ENCODE_V, *ff.ENCODE_A, str(src)])
    item = store.add_media(src, "video", "upload", {"type": "owned"}, {"transcript": _transcript()})
    out = clips.cut(item["id"], 0.0, 9.0, "9:16", "blur", "bold")
    info = ff.probe(out["path"])
    assert (info["width"], info["height"]) == (1080, 1920)
    assert 8.5 < info["duration"] < 9.5
    assert out["meta"]["words"] and out["meta"]["words"][0]["start"] >= 0
