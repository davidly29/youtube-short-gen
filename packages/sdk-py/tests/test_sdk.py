"""Python SDK tests (E12-02). Runs under pytest or plain `python -m unittest`; no network."""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import unittest
from unittest import mock

from shortloop import JobFailedError, ShortLoop, ShortLoopError, parse_webhook, verify_webhook
from shortloop._generated import GeneratedClient

from .fake_api import FakeApi

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "https://shortloop.test/api/v1"


def load_quickstart():
    spec = importlib.util.spec_from_file_location("quickstart", ROOT / "examples" / "quickstart.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.quickstart


def client(api: FakeApi, **kw) -> ShortLoop:
    return ShortLoop(api.key, BASE, transport=api, sleep=lambda _s: None, **kw)


class QuickstartTest(unittest.TestCase):
    def test_creates_approves_and_publishes(self):
        api = FakeApi()
        lines = []
        result = load_quickstart()(client(api), "why octopuses have three hearts", log=lines.append)
        self.assertEqual(result["publish_status"], "published")
        self.assertEqual(result["youtube_url"], "https://www.youtube.com/shorts/fake123")
        self.assertTrue(result["video_url"].endswith(".mp4"))
        self.assertEqual((result["credits_before"], result["credits_after"]), (5, 4))
        paths = [f"{c['method']} {c['path']}" for c in api.calls]
        self.assertEqual(paths[0], "GET /balance")
        self.assertIn("POST /shorts/prj_1/approve", paths)
        self.assertLess(paths.index("POST /shorts/prj_1/approve"), paths.index("POST /shorts/prj_1/publish"))
        # waits on the server, publishes privately by default, sends JSON with a bearer key
        self.assertTrue(all(c["query"] == {"wait": "50"} for c in api.calls if c["path"].startswith("/jobs/")))
        publish = next(c for c in api.calls if c["path"].endswith("/publish"))
        self.assertEqual(publish["body"], {"privacy": "private"})
        self.assertEqual(publish["headers"]["Content-Type"], "application/json")
        self.assertIn("publish published: https://www.youtube.com/shorts/fake123", lines)

    def test_create_short_omits_unset_fields(self):
        api = FakeApi()
        client(api).create_short(topic="octopus hearts", length_seconds=60)
        self.assertEqual(api.calls[-1]["body"], {"topic": "octopus hearts", "length_seconds": 60})


class ErrorsTest(unittest.TestCase):
    def test_bad_key_and_error_envelope(self):
        api = FakeApi()
        with self.assertRaises(ShortLoopError) as ctx:
            ShortLoop("sl_wrong", BASE, transport=api).get_balance()
        self.assertEqual((ctx.exception.status, ctx.exception.code, ctx.exception.operation_id), (401, "unauthorized", "getBalance"))

        sl = client(api)
        short = sl.create_short(topic="octopus hearts")
        sl.wait_for_job(short["job_id"])
        with self.assertRaises(ShortLoopError) as ctx:
            sl.publish_short(short["project_id"])
        self.assertEqual((ctx.exception.status, ctx.exception.code), (400, "invalid_request"))
        self.assertIn("Approve", str(ctx.exception))

    def test_retries_429_then_gives_up(self):
        slept = []
        api = FakeApi(rate_limit_next=2)
        sl = ShortLoop(api.key, BASE, transport=api, sleep=slept.append)
        self.assertEqual(sl.get_balance()["shorts"], 5)
        self.assertEqual(slept, [1, 1])

        busy = FakeApi(rate_limit_next=5)
        with self.assertRaises(ShortLoopError) as ctx:
            ShortLoop(busy.key, BASE, transport=busy, sleep=slept.append, max_retries=1).list_voices()
        self.assertEqual((ctx.exception.status, ctx.exception.code, ctx.exception.retry_after), (429, "rate_limited", 1))

    def test_failed_job_raises(self):
        api = FakeApi(fail_topic="doomed")
        sl = client(api)
        short = sl.create_short(topic="a doomed Short")
        with self.assertRaises(JobFailedError) as ctx:
            sl.wait_for_job(short["job_id"])
        self.assertEqual(ctx.exception.job["status"], "failed")
        self.assertEqual(api.credits, 5)

    def test_paths_are_escaped(self):
        api = FakeApi()
        client(api).get_workflow("myth vs/fact", "start")
        self.assertEqual(api.calls[-1]["path"], "/workflows/myth%20vs%2Ffact/start")

    def test_needs_key_and_url(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "SHORTLOOP_API_KEY"):
                ShortLoop(base_url=BASE)
            with self.assertRaisesRegex(ValueError, "SHORTLOOP_API_URL"):
                ShortLoop(api_key="sl_x")
        with mock.patch.dict(os.environ, {"SHORTLOOP_API_KEY": "sl_env", "SHORTLOOP_API_URL": BASE + "/"}):
            self.assertEqual(ShortLoop().base_url, BASE)


class GeneratedTest(unittest.TestCase):
    def test_every_operation_is_a_method(self):
        expected = {
            "create_short", "approve_short", "swap_visual", "publish_short", "get_job", "list_voices",
            "list_caption_styles", "estimate_cost", "get_balance", "get_trends", "list_workflows", "get_workflow",
            "list_webhooks", "create_webhook", "delete_webhook", "list_deliveries", "get_open_api",
        }
        methods = {n for n in vars(GeneratedClient) if not n.startswith("_")}
        self.assertTrue(expected <= methods, expected - methods)


class WebhookTest(unittest.TestCase):
    SECRET = "whsec_test"
    BODY = json.dumps({"id": "evt_1", "type": "job.succeeded", "created_at": "2026-10-24T10:00:00.000Z",
                       "data": {"job_id": "job_1", "kind": "production", "status": "ready"}})
    NOW = 1_800_000_000

    def sign(self, t, body=None, secret=None):
        mac = hmac.new((secret or self.SECRET).encode(), f"{t}.{body or self.BODY}".encode(), hashlib.sha256)
        return f"t={t},v1={mac.hexdigest()}"

    def test_verify(self):
        ok = lambda h, body=None: verify_webhook(body or self.BODY, h, self.SECRET, now=self.NOW)  # noqa: E731
        self.assertTrue(ok(self.sign(self.NOW)))
        self.assertTrue(verify_webhook(self.BODY.encode(), self.sign(self.NOW), self.SECRET, now=self.NOW))
        self.assertTrue(ok(self.sign(self.NOW - 299)))
        self.assertFalse(ok(self.sign(self.NOW - 301)))
        self.assertFalse(ok(self.sign(self.NOW), self.BODY + " "))
        self.assertFalse(ok(self.sign(self.NOW, secret="other")))
        self.assertFalse(ok(None))
        self.assertFalse(ok("garbage"))
        rotated = self.sign(self.NOW, secret="old") + ",v1=" + self.sign(self.NOW).split("v1=")[1]
        self.assertTrue(ok(rotated))

    def test_parse(self):
        payload = parse_webhook(self.BODY, self.sign(self.NOW), self.SECRET, now=self.NOW)
        self.assertEqual(payload["data"]["job_id"], "job_1")
        with self.assertRaises(ValueError):
            parse_webhook(self.BODY, self.sign(self.NOW - 1000), self.SECRET, now=self.NOW)


if __name__ == "__main__":
    unittest.main()
