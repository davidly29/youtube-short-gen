"""ShortLoop quick-start: make a Short from a topic, approve it and publish it.

    SHORTLOOP_API_URL=https://<app>/api/v1 SHORTLOOP_API_KEY=sl_... python examples/quickstart.py "why octopuses have three hearts"

Publishes as ``private`` unless SHORTLOOP_PRIVACY=public, so a test run never goes live by accident.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Callable, Dict

from shortloop import ShortLoop


def quickstart(sl: ShortLoop, topic: str, privacy: str = "private", log: Callable[[str], None] = lambda _: None) -> Dict[str, Any]:
    before = sl.get_balance()
    log(f"credits: {before['shorts']} Shorts")

    created = sl.create_short(topic=topic, length_seconds=30)
    log(f"making {created['project_id']} (job {created['job_id']})")

    made = sl.wait_for_job(created["job_id"])
    log(f"rendered: {made.get('video_url')}")
    if made.get("publishable") is False:
        raise RuntimeError("Not publishable: " + "; ".join(made.get("problems", [])))

    # A person should watch the video before this in real use: approval is the human-in-the-loop step.
    sl.approve_short(created["project_id"])
    pub = sl.publish_short(created["project_id"], privacy=privacy)  # type: ignore[arg-type]
    published = sl.wait_for_job(pub["job_id"])
    log(f"publish {published['status']}: {published.get('url', '')}")

    after = sl.get_balance()
    return {
        "project_id": created["project_id"],
        "video_url": made.get("video_url"),
        "youtube_url": published.get("url"),
        "publish_status": published["status"],
        "credits_before": before["shorts"],
        "credits_after": after["shorts"],
    }


if __name__ == "__main__":
    result = quickstart(
        ShortLoop(),
        sys.argv[1] if len(sys.argv) > 1 else "why octopuses have three hearts",
        privacy=os.environ.get("SHORTLOOP_PRIVACY", "private"),
        log=print,
    )
    print(json.dumps(result, indent=2))
