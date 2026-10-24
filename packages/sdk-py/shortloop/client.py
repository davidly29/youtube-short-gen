"""ShortLoop API client (E12-02). Standard library only."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Mapping, Optional, Tuple
from urllib.parse import urlencode

from ._generated import GeneratedClient, JobView

#: (method, url, headers, body bytes or None) -> (status, headers, body bytes)
Transport = Callable[[str, str, Mapping[str, str], Optional[bytes]], Tuple[int, Mapping[str, str], bytes]]

USER_AGENT = "shortloop-python/1.0.0"


class ShortLoopError(Exception):
    """Any non-2xx answer. ``code`` and ``message`` come from the API's error envelope."""

    def __init__(self, status: int, code: str, message: str, operation_id: str, retry_after: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.operation_id = operation_id
        self.retry_after = retry_after


class JobFailedError(Exception):
    """Raised by ``wait_for_job`` when the job ended ``failed``; ``job["error"]`` says why."""

    def __init__(self, job: JobView):
        super().__init__(job.get("error") or f"Job {job['job_id']} failed")
        self.job = job


def urllib_transport(timeout: float = 70.0) -> Transport:
    def send(method: str, url: str, headers: Mapping[str, str], body: Optional[bytes]):
        req = urllib.request.Request(url, data=body, method=method, headers=dict(headers))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (https URL from the caller)
                return res.status, dict(res.headers.items()), res.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers.items()), e.read()

    return send


class ShortLoop(GeneratedClient):
    """The ShortLoop API. Every endpoint is a method (generated from the OpenAPI spec), plus ``wait_for_job``.

    >>> sl = ShortLoop(api_key="sl_...", base_url="https://<app>/api/v1")
    >>> short = sl.create_short(topic="why octopuses have three hearts")
    >>> job = sl.wait_for_job(short["job_id"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        *,
        transport: Optional[Transport] = None,
        max_retries: int = 2,
        max_retry_after: int = 60,
        sleep: Callable[[float], None] = time.sleep,
    ):
        api_key = api_key or os.environ.get("SHORTLOOP_API_KEY")
        base_url = base_url or os.environ.get("SHORTLOOP_API_URL")
        if not api_key:
            raise ValueError("ShortLoop: pass api_key or set SHORTLOOP_API_KEY (Settings → Developer).")
        if not base_url:
            raise ValueError("ShortLoop: pass base_url or set SHORTLOOP_API_URL, e.g. https://<app>/api/v1.")
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._transport = transport or urllib_transport()
        self._max_retries = max_retries
        self._max_retry_after = max_retry_after
        self._sleep = sleep

    def _request(
        self,
        operation_id: str,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self.base_url + path
        params = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in (query or {}).items() if v is not None}
        if params:
            url += "?" + urlencode(params)
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "application/json", "User-Agent": USER_AGENT}
        data: Optional[bytes] = None
        if method != "GET":
            headers["Content-Type"] = "application/json"
            data = json.dumps(body or {}).encode()
        attempt = 0
        while True:
            status, res_headers, raw = self._transport(method, url, headers, data)
            payload = _json(raw)
            if 200 <= status < 300:
                return payload
            retry_after = _int({k.lower(): v for k, v in res_headers.items()}.get("retry-after"))
            if status == 429 and attempt < self._max_retries and retry_after is not None and retry_after <= self._max_retry_after:
                attempt += 1
                self._sleep(max(0, retry_after))
                continue
            err = payload.get("error", {}) if isinstance(payload, dict) else {}
            raise ShortLoopError(
                status,
                err.get("code", "unknown"),
                err.get("message", f"HTTP {status} from {operation_id}"),
                operation_id,
                retry_after,
            )

    def wait_for_job(self, job_id: str, *, timeout: float = 600.0, wait_seconds: int = 50) -> JobView:
        """Wait until a job is done, holding each request up to 50 s on the server. Raises JobFailedError on failure."""
        deadline = time.monotonic() + timeout
        while True:
            job = self.get_job(job_id, wait=wait_seconds)
            if job["done"]:
                if job["status"] == "failed":
                    raise JobFailedError(job)
                return job
            if time.monotonic() > deadline:
                raise TimeoutError(f"ShortLoop: job {job_id} still {job['status']} after {timeout}s")


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode() or "null")
    except ValueError:
        return None


def _int(v: Optional[str]) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None
