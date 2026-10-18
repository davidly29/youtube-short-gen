"""Text-to-speech with word timings.

Providers
- edge:       free Microsoft Edge neural voices (no key; needs internet). Real word timings.
- elevenlabs: ELEVENLABS_API_KEY. Real character timings -> word timings.
- openai:     OPENAI_API_KEY. No timings returned, so they are estimated.
- offline:    silent track with estimated timings, for testing the pipeline without a network.
"""
from __future__ import annotations

import asyncio
import base64
import re
from pathlib import Path
from typing import Any

import httpx

from . import ff, store
from .config import settings

EDGE_VOICES = [
    {"id": "en-US-AndrewMultilingualNeural", "label": "Andrew (US, warm male)"},
    {"id": "en-US-EmmaMultilingualNeural", "label": "Emma (US, bright female)"},
    {"id": "en-US-BrianMultilingualNeural", "label": "Brian (US, casual male)"},
    {"id": "en-US-AvaMultilingualNeural", "label": "Ava (US, expressive female)"},
    {"id": "en-US-ChristopherNeural", "label": "Christopher (US, deep narrator)"},
    {"id": "en-GB-RyanNeural", "label": "Ryan (UK male)"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia (UK female)"},
    {"id": "en-IE-ConnorNeural", "label": "Connor (Irish male)"},
    {"id": "en-IE-EmilyNeural", "label": "Emily (Irish female)"},
    {"id": "en-AU-WilliamNeural", "label": "William (AU male)"},
]
ELEVEN_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"  # "George" in the ElevenLabs public library
OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"]

WORD_RE = re.compile(r"\S+")


def estimate_words(text: str, total_s: float) -> list[dict[str, Any]]:
    """Spread words over a duration proportionally to their length (+ pause after punctuation)."""
    words = WORD_RE.findall(text)
    if not words:
        return []
    weights = [len(w) + (3 if w[-1] in ".!?" else 1.5 if w[-1] in ",;:" else 0) + 2 for w in words]
    scale = total_s / sum(weights)
    t, out = 0.0, []
    for w, wt in zip(words, weights):
        dur = wt * scale
        out.append({"text": w, "start": round(t, 3), "end": round(t + dur * 0.9, 3)})
        t += dur
    return out


async def _edge(text: str, voice: str, rate: str, out: Path) -> list[dict[str, Any]]:
    import edge_tts

    comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words: list[dict[str, Any]] = []
    with out.open("wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"text": chunk["text"], "start": round(start, 3),
                              "end": round(start + chunk["duration"] / 1e7, 3)})
    return words


def _attach_punctuation(text: str, words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Edge returns bare words; re-attach punctuation from the source text so captions read naturally."""
    tokens = WORD_RE.findall(text)
    if len(tokens) != len(words):
        return words
    for w, tok in zip(words, tokens):
        w["text"] = tok
    return words


def _eleven(text: str, voice: str, out: Path) -> list[dict[str, Any]]:
    if not settings.elevenlabs_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice or ELEVEN_DEFAULT_VOICE}/with-timestamps",
        headers={"xi-api-key": settings.elevenlabs_key},
        json={"text": text, "model_id": "eleven_multilingual_v2"},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    out.write_bytes(base64.b64decode(data["audio_base64"]))
    al = data.get("alignment") or {}
    chars, starts, ends = al.get("characters", []), al.get("character_start_times_seconds", []), al.get("character_end_times_seconds", [])
    words, cur, cs = [], "", None
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append({"text": cur, "start": round(cs, 3), "end": round(prev_e, 3)})
            cur, cs = "", None
            continue
        if cs is None:
            cs = s
        cur += ch
        prev_e = e
    if cur:
        words.append({"text": cur, "start": round(cs, 3), "end": round(prev_e, 3)})
    return words


def _openai(text: str, voice: str, out: Path) -> None:
    if not settings.openai_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    r = httpx.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {settings.openai_key}"},
        json={"model": "gpt-4o-mini-tts", "voice": voice or "onyx", "input": text, "response_format": "mp3"},
        timeout=120,
    )
    r.raise_for_status()
    out.write_bytes(r.content)


def _run_coro(coro):
    """Run a coroutine even when called from inside the MCP server's running event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(asyncio.run, coro).result()


def synthesize(text: str, voice: str | None = None, provider: str | None = None, speed: float = 1.0) -> dict[str, Any]:
    """Generate narration. Returns a registered audio media item with word timings in meta.words."""
    provider = (provider or settings.tts_provider).lower()
    text = " ".join(text.split())
    if not text:
        raise ValueError("text is empty")
    media_id = store.new_id("aud")
    out = store.media_path(media_id, "mp3")

    if provider == "edge":
        rate = f"{round((speed - 1) * 100):+d}%"
        words = _run_coro(_edge(text, voice or EDGE_VOICES[0]["id"], rate, out))
        words = _attach_punctuation(text, words)
    elif provider == "elevenlabs":
        words = _eleven(text, voice or "", out)
    elif provider == "openai":
        _openai(text, voice or "onyx", out)
        words = []
    elif provider == "offline":
        secs = max(1.0, len(WORD_RE.findall(text)) / (2.6 * speed))
        ff.run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{secs:.2f}", "-c:a", "libmp3lame", str(out)])
        words = []
    else:
        raise ValueError(f"Unknown TTS provider '{provider}'. Use edge, elevenlabs, openai or offline.")

    info = ff.probe(out)
    if not words:
        words = estimate_words(text, info["duration"])
    store.log_usage(provider, "voiceover", len(text), "chars")
    return store.add_media(
        out, "audio", source="ai_generated",
        licence={"type": "ai_generated", "provider": provider, "voice": voice},
        meta={"duration": info["duration"], "text": text, "words": words, "timing": "real" if provider in {"edge", "elevenlabs"} else "estimated"},
        media_id=media_id,
    )
