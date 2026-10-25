"""An in-memory ShortLoop API behind a transport function (no sockets): same rules as the real one."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Mapping, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlsplit


class FakeApi:
    def __init__(self, key: str = "sl_test_key", credits: int = 5, rate_limit_next: int = 0, fail_topic: Optional[str] = None):
        self.key = key
        self.credits = credits
        self.rate_limit_next = rate_limit_next
        self.fail_topic = fail_topic
        self.projects: Dict[str, Dict[str, Any]] = {}
        self.publishes: Dict[str, Dict[str, Any]] = {}
        self.calls: List[Dict[str, Any]] = []
        self._seq = 0

    def __call__(self, method: str, url: str, headers: Mapping[str, str], body: Optional[bytes]) -> Tuple[int, Mapping[str, str], bytes]:
        parts = urlsplit(url)
        path = re.sub(r"^/api/v1", "", parts.path)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        data = json.loads(body) if body else None
        if self.rate_limit_next > 0:
            self.rate_limit_next -= 1
            status, extra, out = 429, {"Retry-After": "1"}, self._err("rate_limited", "Slow down.")
        elif headers.get("Authorization") != f"Bearer {self.key}":
            status, extra, out = 401, {}, self._err("unauthorized", "Missing, unknown or revoked API key.")
        else:
            status, out = self._route(method, path, query, data or {})
            extra = {"X-RateLimit-Limit": "60"}
        self.calls.append({"method": method, "path": path, "query": query, "body": data, "status": status, "headers": dict(headers)})
        return status, {"Content-Type": "application/json", **extra}, json.dumps(out).encode()

    @staticmethod
    def _err(code: str, message: str) -> Dict[str, Any]:
        return {"error": {"code": code, "message": message}}

    def _route(self, method: str, path: str, query: Dict[str, str], body: Dict[str, Any]) -> Tuple[int, Any]:
        if method == "GET" and path == "/balance":
            return 200, {"shorts": self.credits, "ai_video_credits": 0, "plan": "free"}
        if method == "GET" and path == "/voices":
            return 200, {"voices": [{"id": "edge:en-US-AriaNeural", "label": "Aria", "language": "en-US", "provider": "edge", "commercial_use": True}]}
        if method == "POST" and path == "/shorts":
            if len(body.get("topic", "")) < 3:
                return 400, self._err("invalid_request", "topic: must be at least 3 characters")
            if self.credits < 1:
                return 400, self._err("invalid_request", "No Short credits left.")
            self._seq += 1
            pid = f"prj_{self._seq}"
            failed = bool(self.fail_topic and self.fail_topic in body["topic"])
            if not failed:
                self.credits -= 1
            self.projects[pid] = {"status": "producing", "polls": 0, "failed": failed}
            return 202, {"project_id": pid, "job_id": f"job_{pid}", "status": "producing", "next": "GET /jobs/{job_id}?wait=50"}
        m = re.match(r"^/shorts/([^/]+)/(approve|publish)$", path)
        if m and method == "POST":
            pid, action = unquote(m.group(1)), m.group(2)
            p = self.projects.get(pid)
            if not p:
                return 404, self._err("not_found", "No such Short")
            if action == "approve":
                if p["status"] == "producing":
                    return 400, self._err("invalid_request", "Wait for the render to finish first.")
                p["status"] = "approved"
                return 200, {"project_id": pid, "approved": True}
            if p["status"] != "approved":
                return 400, self._err("invalid_request", "Approve the Short before publishing it.")
            self._seq += 1
            pub = f"pub_{self._seq}"
            self.publishes[pub] = {"project": pid, "polls": 0, "privacy": body.get("privacy", "public")}
            return 202, {"publish_id": pub, "job_id": f"pubjob_{pub}", "status": "queued", "next": "GET /jobs/{job_id}?wait=50"}
        m = re.match(r"^/jobs/([^/]+)$", path)
        if m and method == "GET":
            jid = unquote(m.group(1))
            if jid.startswith("pubjob_"):
                pub = self.publishes.get(jid[len("pubjob_"):])
                if not pub:
                    return 404, self._err("not_found", "No such job")
                pub["polls"] += 1
                done = pub["polls"] >= 2
                view = {"job_id": jid, "kind": "publish", "project_id": pub["project"], "status": "published" if done else "uploading", "progress": 1 if done else 0.5, "done": done}
                if done:
                    view["url"] = "https://www.youtube.com/shorts/fake123"
                return 200, view
            pid = jid[len("job_"):]
            p = self.projects.get(pid)
            if not p:
                return 404, self._err("not_found", "No such job")
            if p["failed"]:
                return 200, {"job_id": jid, "kind": "production", "project_id": pid, "status": "failed", "progress": 1, "done": True, "error": "Render failed (fake). Your credit was refunded."}
            if p["status"] == "producing":
                p["polls"] += 1
                if p["polls"] >= 2:
                    p["status"] = "ready"
            done = p["status"] != "producing"
            view = {"job_id": jid, "kind": "production", "project_id": pid, "status": p["status"], "progress": 1 if done else 0.6, "done": done}
            if done:
                view.update({"video_url": f"https://files.test/{pid}.mp4", "publishable": True, "problems": []})
            return 200, view
        if m := re.match(r"^/workflows/([^/]+)/([^/]+)$", path):
            return 200, {"slug": unquote(m.group(1)), "phase": unquote(m.group(2)), "markdown": "# Start\n"}
        return 404, self._err("not_found", "No such endpoint")
