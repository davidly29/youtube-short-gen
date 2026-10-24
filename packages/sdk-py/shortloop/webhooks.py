"""Verify ShortLoop webhook signatures: ``ShortLoop-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">``."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Optional, Union

from ._generated import WebhookPayload

SIGNATURE_HEADER = "ShortLoop-Signature"
DEFAULT_TOLERANCE_SECONDS = 300


def verify_webhook(
    raw_body: Union[str, bytes],
    signature_header: Optional[str],
    secret: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: Optional[int] = None,
) -> bool:
    """True when the header was made with ``secret`` over this exact body within the last 5 minutes."""
    if not signature_header or not secret:
        return False
    body = raw_body.decode() if isinstance(raw_body, bytes) else raw_body
    parts: dict = {}
    for piece in signature_header.split(","):
        key, sep, value = piece.partition("=")
        if sep and key.strip():
            parts.setdefault(key.strip(), []).append(value.strip())
    try:
        t = int(parts.get("t", [""])[0])
    except ValueError:
        return False
    if abs((now if now is not None else int(time.time())) - t) > tolerance_seconds:
        return False
    expected = hmac.new(secret.encode(), f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(v.lower(), expected) for v in parts.get("v1", []))


def parse_webhook(
    raw_body: Union[str, bytes],
    signature_header: Optional[str],
    secret: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: Optional[int] = None,
) -> WebhookPayload:
    """Verify, then parse. Raises ValueError if the signature is missing, wrong or stale."""
    if not verify_webhook(raw_body, signature_header, secret, tolerance_seconds=tolerance_seconds, now=now):
        raise ValueError("ShortLoop webhook: bad or stale signature")
    return json.loads(raw_body)
