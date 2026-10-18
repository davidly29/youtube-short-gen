# ADR 0004: FFmpeg renderer for v1 (Remotion deferred)

- Status: proposed in the S0 batch PR; owner to confirm
- Date: 2026-10-18

## Decision

`@shortloop/render` renders a `Timeline` with FFmpeg: one segment per clip (Ken Burns via `zoompan` for stills),
concat, delayed/mixed audio, and captions burned in from an ASS file (libass). Remotion is not used in v1.

## Why

- The OpenGen POC already proved this pipeline end to end (`poc/opengen-mcp/opengen/compose.py`).
- No headless Chromium in the worker image or CI: smaller image, faster renders (the 3 s fixture renders in ~3 s).
- Fewer moving parts gets a working app to beta sooner.

## Consequences

- Caption presets (E6-02) are ASS styles rather than React components; the six preset ids in the contracts stay the same.
- Revisit if we need rich motion graphics or brand templates that ASS can't express (likely with E11-03 brand kits).
