# OpenGen MCP: project context for Claude Code

## What this is
A personal, non-commercial learning clone of Everygen-style short-form video MCP servers.
The owner (David) wants to understand how such a tool works by running his own copy instead of paying
for the subscription. It is the proof of concept (POC) before a larger product idea (working name
"ShortLoop": trend-led, rights-clean Shorts, web app + MCP, publish + learn loop). The business plan and
backlog for ShortLoop live in a separate doc and are out of scope here unless asked.

## Ground rules
- Only media the user owns or generated media. `import_media` refuses YouTube/TikTok/Instagram/etc. links on purpose; keep that.
- No posting to platforms in the POC.
- Everygen's public docs only name `compose_video`, its OAuth scopes (media upload, image, video, voiceover,
  voice change, audio, generation read) and a list of workflow types. Our other tool names are our own; don't
  claim they match Everygen's.
- Free providers are the defaults; paid ones (ElevenLabs, fal.ai, OpenAI) are optional, using the user's own keys.

## Architecture
- `opengen/server.py`: FastMCP (mcp SDK v1, pinned `<2`) with 19 tools; stdio by default, `--http` for Streamable HTTP + `/files/` route.
- Long work (`compose_video`, `generate_video`, `transcribe_media`) runs in background threads as jobs in SQLite; poll with `wait_for_job`.
- `compose.py` times each scene to its own narration, renders it to WxH@30fps, concats, burns ASS captions, ducks music.
- `tts.py` edge (default, real word timings) / elevenlabs / openai / offline. Sync tools run inside the server's
  event loop, so async code must go through `_run_coro` (never bare `asyncio.run`).
- `images.py` pollinations (default) / fal / openai / card (offline). `video_gen.py` kenburns (default) / fal queue API.
- `captions.py` 6 ASS styles. `clips.py` heuristic `find_clips` + `cut`. `transcribe.py` faster-whisper (optional extra).
- Data lives in `OPENGEN_HOME` (default `~/.opengen`): `media/`, `work/`, `opengen.sqlite3`.

## Tests
`pytest -q` runs 6 tests fully offline (offline voice, card images, Ken Burns), including an end-to-end
MCP stdio client session. Keep them passing; add a test for any new tool.

## Environment notes (David's machine)
- Windows, PowerShell 5.1: no `&&`, no `source`. Activate with `.\.venv\Scripts\Activate.ps1`.
- `faster-whisper` failed to install: ctranslate2 only has Windows wheels for 64-bit CPython 3.9-3.14.
  Install without the `[whisper]` extra, or use 64-bit Python 3.12 (`py -3.12 -m venv .venv`).
- Claude Desktop config: `%APPDATA%\Claude\claude_desktop_config.json`, command = `.venv\Scripts\opengen-mcp.exe` with doubled backslashes.

## Status (2026-10-18)
- Built and tested in a Linux sandbox that could not reach Edge TTS or Pollinations, so real-provider runs are
  untested. The first real run on Windows is the next step: check `generate_voiceover` (edge),
  `generate_image` (pollinations), then a full `compose_video`.
- Known gaps: no face-tracking reframe, no voice changer, no music generation, no auth on HTTP mode (localhost only).
