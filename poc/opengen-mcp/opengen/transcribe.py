"""Speech-to-text with word timestamps, using faster-whisper locally (free, runs on CPU)."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from . import store
from .config import settings


@lru_cache(maxsize=2)
def _model(name: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("Transcription needs faster-whisper: pip install 'opengen-mcp[whisper]'") from e
    return WhisperModel(name, device="auto", compute_type="int8")


def transcribe(path: str, language: str | None = None, model: str | None = None) -> dict[str, Any]:
    m = _model(model or settings.whisper_model)
    segments, info = m.transcribe(path, language=language, word_timestamps=True, vad_filter=True)
    segs, words = [], []
    for s in segments:
        sw = [{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in (s.words or []) if w.word.strip()]
        words.extend(sw)
        segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
    store.log_usage("whisper-local", "transcribe", segs[-1]["end"] if segs else 0, "seconds")
    return {"language": info.language, "duration": round(info.duration, 2), "segments": segs, "words": words}
