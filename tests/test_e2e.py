"""End-to-end test: launches the server over stdio and drives it like an MCP client would.

Uses only offline providers (silent voice, card images, Ken Burns), so it needs no network or keys.
Run: OPENGEN_HOME=$(mktemp -d) pytest -q tests/test_e2e.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

EXPECTED_TOOLS = {
    "list_workflows", "get_workflow", "list_options", "import_media", "list_media", "preview_media",
    "generate_voiceover", "generate_image", "generate_video", "transcribe_media", "find_clips", "cut_clip",
    "reframe_video", "add_captions", "compose_video", "get_job", "wait_for_job", "estimate_cost", "get_usage",
}


def _data(result):
    assert not result.isError, result.content
    if result.structuredContent is not None:
        sc = result.structuredContent
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    return json.loads(result.content[0].text)


async def _wait(s, job_id):
    for _ in range(20):
        job = _data(await s.call_tool("wait_for_job", {"job_id": job_id, "timeout_seconds": 50}))
        if job["status"] in {"succeeded", "failed"}:
            return job
    raise TimeoutError(job_id)


async def scenario() -> dict:
    env = {**os.environ, "OPENGEN_TTS": "offline", "OPENGEN_IMAGE": "card", "OPENGEN_VIDEO": "kenburns"}
    params = StdioServerParameters(command=sys.executable, args=["-m", "opengen.server"], env=env)
    async with stdio_client(params) as (r, w), ClientSession(r, w) as s:
        await s.initialize()
        tools = {t.name for t in (await s.list_tools()).tools}
        assert EXPECTED_TOOLS <= tools, EXPECTED_TOOLS - tools

        wfs = _data(await s.call_tool("list_workflows", {}))
        assert any(w["slug"] == "faceless-story" for w in wfs)
        phase = (await s.call_tool("get_workflow", {"slug": "faceless-story", "phase": "script"})).content[0].text
        assert "hook" in phase.lower()

        scenes = [
            {"narration": "Why do octopuses have three hearts?", "image_prompt": "An octopus with three glowing hearts"},
            {"narration": "Two hearts pump blood through the gills, one feeds the body.", "image_prompt": "Diagram of octopus gills"},
            {"narration": "And when it swims, the body heart stops. That is why they prefer crawling.", "image_prompt": "Octopus crawling on reef"},
        ]
        est = _data(await s.call_tool("estimate_cost", {"scenes": scenes}))
        assert est["within_180s_limit"]

        job = _data(await s.call_tool("compose_video", {"scenes": scenes, "caption_style": "pop", "title": "Octopus hearts"}))
        done = await _wait(s, job["job_id"])
        assert done["status"] == "succeeded", done
        vid = done["output"]
        assert vid["meta"]["width"] == 1080 and vid["meta"]["height"] == 1920
        assert 4 < vid["meta"]["duration"] < 15

        prev = await s.call_tool("preview_media", {"media_id": vid["id"], "at_seconds": 1.0})
        assert prev.content[0].type == "image"

        clip = _data(await s.call_tool("reframe_video", {"media_id": vid["id"], "aspect_ratio": "1:1", "mode": "blur"}))
        assert clip["meta"]["width"] == 1080 and clip["meta"]["height"] == 1080

        recap = _data(await s.call_tool("add_captions", {"media_id": vid["id"], "style": "karaoke"}))
        assert recap["meta"]["has_audio"]

        bad = await s.call_tool("import_media", {"path_or_url": "https://www.youtube.com/watch?v=x", "owned_or_licensed": True})
        assert bad.isError

        usage = _data(await s.call_tool("get_usage", {}))
        assert any(u["operation"] == "render" for u in usage)
        return {"video": vid["path"], "duration": vid["meta"]["duration"], "tools": len(tools)}


def test_end_to_end():
    out = asyncio.run(scenario())
    print(out)


if __name__ == "__main__":
    print(asyncio.run(scenario()))
