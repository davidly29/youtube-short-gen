"""Runtime configuration, read from environment variables (and an optional .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader so users don't need python-dotenv."""
    for candidate in (Path.cwd() / ".env", Path(__file__).resolve().parent.parent / ".env"):
        if not candidate.is_file():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    home: Path = field(default_factory=lambda: Path(os.environ.get("OPENGEN_HOME", Path.home() / ".opengen")).expanduser())
    public_base_url: str = os.environ.get("OPENGEN_PUBLIC_BASE_URL", "").rstrip("/")
    font: str = os.environ.get("OPENGEN_FONT", "Arial")

    # Default providers (each can be overridden per call)
    tts_provider: str = os.environ.get("OPENGEN_TTS", "edge")            # edge | elevenlabs | openai | offline
    image_provider: str = os.environ.get("OPENGEN_IMAGE", "pollinations")  # pollinations | fal | openai | card
    video_provider: str = os.environ.get("OPENGEN_VIDEO", "kenburns")      # kenburns | fal
    whisper_model: str = os.environ.get("OPENGEN_WHISPER_MODEL", "base")

    # Optional paid-provider keys
    elevenlabs_key: str = os.environ.get("ELEVENLABS_API_KEY", "")
    fal_key: str = os.environ.get("FAL_KEY", "")
    openai_key: str = os.environ.get("OPENAI_API_KEY", "")
    fal_image_model: str = os.environ.get("OPENGEN_FAL_IMAGE_MODEL", "fal-ai/flux/schnell")
    fal_t2v_model: str = os.environ.get("OPENGEN_FAL_T2V_MODEL", "fal-ai/kling-video/v2.1/standard/text-to-video")
    fal_i2v_model: str = os.environ.get("OPENGEN_FAL_I2V_MODEL", "fal-ai/kling-video/v2.1/standard/image-to-video")

    @property
    def media_dir(self) -> Path:
        return self.home / "media"

    @property
    def work_dir(self) -> Path:
        return self.home / "work"

    @property
    def db_path(self) -> Path:
        return self.home / "opengen.sqlite3"


settings = Settings()
for d in (settings.home, settings.media_dir, settings.work_dir):
    d.mkdir(parents=True, exist_ok=True)

ASPECTS = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
}
MAX_VIDEO_SECONDS = 180.0
FPS = 30
