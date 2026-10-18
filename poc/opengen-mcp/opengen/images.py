"""Image generation.

Providers
- pollinations: free, no key (needs internet). Flux-class quality, rate limited.
- fal:          FAL_KEY, model from OPENGEN_FAL_IMAGE_MODEL (default flux/schnell).
- openai:       OPENAI_API_KEY, gpt-image-1.
- card:         offline title card drawn with Pillow (for testing, or text slides).
"""
from __future__ import annotations

import base64
import hashlib
import random
import textwrap
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFont

from . import store
from .config import ASPECTS, settings

STYLE_PRESETS = {
    "photoreal": "photorealistic, natural light, 35mm photo, high detail",
    "cinematic": "cinematic film still, dramatic lighting, shallow depth of field, anamorphic",
    "3d": "stylized 3D render, soft global illumination, clay-like materials, Pixar-style",
    "hand-drawn": "hand-drawn ink and watercolor illustration, sketchbook style",
    "whiteboard": "black marker whiteboard doodle on white background, simple line art",
    "storyboard": "pencil storyboard frame, rough shading, grayscale",
    "anime": "anime key visual, vibrant colors, clean line art",
    "none": "",
}


def _gen_size(aspect: str) -> tuple[int, int]:
    w, h = ASPECTS.get(aspect, ASPECTS["9:16"])
    # Generate at ~1 megapixel, multiples of 64, then upscale in the renderer.
    scale = (1_000_000 / (w * h)) ** 0.5
    return int(w * scale) // 64 * 64, int(h * scale) // 64 * 64


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf", "Poppins-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _card(prompt: str, aspect: str, out: Path) -> None:
    w, h = ASPECTS.get(aspect, ASPECTS["9:16"])
    seed = int(hashlib.md5(prompt.encode()).hexdigest()[:8], 16)
    rnd = random.Random(seed)
    c1 = tuple(rnd.randint(20, 120) for _ in range(3))
    c2 = tuple(rnd.randint(120, 230) for _ in range(3))
    mask = Image.linear_gradient("L").resize((w, h))
    img = Image.composite(Image.new("RGB", (w, h), c2), Image.new("RGB", (w, h), c1), mask)
    d = ImageDraw.Draw(img)
    font = _font(int(w * 0.07))
    lines = textwrap.wrap(prompt, width=18)[:6]
    line_h = int(w * 0.09)
    y = int(h * 0.18)  # upper third, clear of the caption zone
    for line in lines:
        tw = d.textlength(line, font=font)
        d.text(((w - tw) / 2, y), line, font=font, fill="white", stroke_width=4, stroke_fill="black")
        y += line_h
    img.save(out)


def generate(prompt: str, aspect: str = "9:16", style: str = "none", provider: str | None = None, seed: int | None = None) -> dict[str, Any]:
    provider = (provider or settings.image_provider).lower()
    full_prompt = ", ".join(p for p in (prompt.strip(), STYLE_PRESETS.get(style, style)) if p)
    media_id = store.new_id("img")
    out = store.media_path(media_id, "png")
    gw, gh = _gen_size(aspect)

    if provider == "pollinations":
        q = urllib.parse.quote(full_prompt, safe="")
        params = {"width": gw, "height": gh, "nologo": "true", "model": "flux", "seed": seed if seed is not None else random.randint(0, 2**31)}
        r = httpx.get(f"https://image.pollinations.ai/prompt/{q}", params=params, timeout=180, follow_redirects=True)
        r.raise_for_status()
        out = out.with_suffix(".jpg")
        out.write_bytes(r.content)
    elif provider == "fal":
        if not settings.fal_key:
            raise RuntimeError("FAL_KEY is not set")
        body: dict[str, Any] = {"prompt": full_prompt, "image_size": {"width": gw, "height": gh}, "num_images": 1}
        if seed is not None:
            body["seed"] = seed
        r = httpx.post(f"https://fal.run/{settings.fal_image_model}", json=body,
                       headers={"Authorization": f"Key {settings.fal_key}"}, timeout=300)
        r.raise_for_status()
        url = r.json()["images"][0]["url"]
        out = out.with_suffix(".jpg")
        out.write_bytes(httpx.get(url, timeout=120).content)
    elif provider == "openai":
        if not settings.openai_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        size = "1024x1536" if gh > gw else "1536x1024" if gw > gh else "1024x1024"
        r = httpx.post("https://api.openai.com/v1/images/generations",
                       headers={"Authorization": f"Bearer {settings.openai_key}"},
                       json={"model": "gpt-image-1", "prompt": full_prompt, "size": size}, timeout=300)
        r.raise_for_status()
        out.write_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]))
    elif provider == "card":
        _card(prompt, aspect, out)
    else:
        raise ValueError(f"Unknown image provider '{provider}'. Use pollinations, fal, openai or card.")

    store.log_usage(provider, "image", 1, "images")
    with Image.open(out) as im:
        size = im.size
    return store.add_media(
        out, "image", source="ai_generated",
        licence={"type": "ai_generated", "provider": provider, "prompt": full_prompt},
        meta={"width": size[0], "height": size[1], "prompt": prompt, "style": style, "aspect": aspect},
        media_id=media_id,
    )
