"""ShortLoop Python SDK (E12-02): make, approve and publish original Shorts from your own code."""
from ._generated import *  # noqa: F401,F403  (TypedDicts for every request and response)
from ._generated import API_VERSION, SPEC_SHA256
from .client import JobFailedError, ShortLoop, ShortLoopError, urllib_transport
from .webhooks import SIGNATURE_HEADER, parse_webhook, verify_webhook

__all__ = [
    "API_VERSION",
    "SPEC_SHA256",
    "JobFailedError",
    "ShortLoop",
    "ShortLoopError",
    "SIGNATURE_HEADER",
    "parse_webhook",
    "urllib_transport",
    "verify_webhook",
]
__version__ = "1.0.0"
