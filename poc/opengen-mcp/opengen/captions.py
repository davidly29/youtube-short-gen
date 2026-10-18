"""Animated captions rendered as ASS subtitles and burned in with ffmpeg/libass."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import settings

# Colours are ASS &HAABBGGRR
STYLES: dict[str, dict[str, Any]] = {
    "bold": {"desc": "Big white uppercase words, thick black outline, 2-3 words at a time",
             "size": 0.075, "upper": True, "words": 3, "primary": "&H00FFFFFF", "outline": "&H00000000",
             "border": 6, "shadow": 0, "box": False, "highlight": None, "pos": 0.62},
    "karaoke": {"desc": "Full phrase shown, the spoken word turns yellow",
                "size": 0.065, "upper": False, "words": 4, "primary": "&H00FFFFFF", "outline": "&H00000000",
                "border": 5, "shadow": 0, "box": False, "highlight": "&H0000E5FF", "pos": 0.62},
    "pop": {"desc": "Active word grows and turns green (Hormozi-style)",
            "size": 0.08, "upper": True, "words": 3, "primary": "&H00FFFFFF", "outline": "&H00000000",
            "border": 6, "shadow": 2, "box": False, "highlight": "&H0050FF39", "scale": 118, "pos": 0.6},
    "boxed": {"desc": "White text on a dark rounded box, calm and readable",
              "size": 0.055, "upper": False, "words": 5, "primary": "&H00FFFFFF", "outline": "&H64000000",
              "border": 14, "shadow": 0, "box": True, "highlight": None, "pos": 0.7},
    "minimal": {"desc": "Small subtitle line near the bottom of the safe area",
                "size": 0.042, "upper": False, "words": 7, "primary": "&H00FFFFFF", "outline": "&H00000000",
                "border": 2, "shadow": 1, "box": False, "highlight": None, "pos": 0.76},
    "neon": {"desc": "Magenta glow outline with cyan active word",
             "size": 0.07, "upper": True, "words": 2, "primary": "&H00FFFFFF", "outline": "&H00FF00C8",
             "border": 5, "shadow": 3, "box": False, "highlight": "&H00FFFF00", "pos": 0.6},
}


def _ts(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def pages(words: list[dict[str, Any]], per_page: int) -> list[list[dict[str, Any]]]:
    """Group words into caption pages, breaking early after sentence punctuation or long gaps."""
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt["start"] - w["end"]) if nxt else 0
        if len(cur) >= per_page or w["text"][-1:] in ".!?" or gap > 0.6:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def build_ass(words: list[dict[str, Any]], width: int, height: int, style: str = "bold", font: str | None = None) -> str:
    st = STYLES.get(style)
    if st is None:
        raise ValueError(f"Unknown caption style '{style}'. Options: {', '.join(STYLES)}")
    font = font or settings.font
    size = int(width * st["size"]) if width < height else int(height * st["size"] * 0.9)
    margin_v = int(height * (1 - st["pos"]))
    border_style = 3 if st["box"] else 1
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{size},{st['primary']},&H000000FF,{st['outline']},&H80000000,-1,0,0,0,100,100,0,0,{border_style},{st['border']},{st['shadow']},2,{int(width*0.08)},{int(width*0.12)},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for page in pages(words, st["words"]):
        texts = [_esc(w["text"].upper() if st["upper"] else w["text"]) for w in page]
        page_end = page[-1]["end"] + 0.12
        if not st["highlight"]:
            lines.append(f"Dialogue: 0,{_ts(page[0]['start'])},{_ts(page_end)},Cap,,0,0,0,,{' '.join(texts)}")
            continue
        scale = st.get("scale", 100)
        for i, w in enumerate(page):
            start = w["start"]
            end = page[i + 1]["start"] if i + 1 < len(page) else page_end
            parts = []
            for j, t in enumerate(texts):
                if j == i:
                    parts.append(f"{{\\c{st['highlight']}\\fscx{scale}\\fscy{scale}}}{t}{{\\r}}")
                else:
                    parts.append(t)
            lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Cap,,0,0,0,,{' '.join(parts)}")
    return header + "\n".join(lines) + "\n"


def write_ass(words: list[dict[str, Any]], width: int, height: int, style: str, out: Path) -> Path:
    out.write_text(build_ass(words, width, height, style), encoding="utf-8")
    return out


def ass_filter(path: Path) -> str:
    # Escape for the ffmpeg filter graph (colons and backslashes in paths).
    p = str(path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    return f"ass='{p}'"
