---
title: Clip my long video
summary: Turn the user's own long video or podcast into several captioned vertical Shorts.
---
## start
`import_media` the user's own video (local path or direct link). Never use other people's videos.

## script
1. `transcribe_media`.
2. `find_clips` (max_clips 5, 20–60 s). Read each candidate's text yourself and re-rank: the best clip has a hook in the first 3 seconds, one complete idea, and a payoff at the end. Adjust start/end to sentence boundaries if needed.

## visuals
`cut_clip` for each chosen window with `aspect: "9:16"`, `reframe: "crop"` for a single speaker or `"blur"` for wide shots, and `caption_style: "bold"`.

## publish
Return each clip with a suggested hook title.
