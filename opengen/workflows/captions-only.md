---
title: Captions on an existing video
summary: Add animated captions to a video you already have.
---
## start
Call `import_media` with the user's file path or direct URL of a video they own.

## script
Call `transcribe_media`. Show the user the transcript and fix any misheard names.

## visuals
Call `add_captions` with the chosen style. Use `reframe_video` first if they want 9:16 from landscape (mode "blur" keeps the whole frame, "crop" fills it).

## publish
Preview at a talking moment to check caption placement.
