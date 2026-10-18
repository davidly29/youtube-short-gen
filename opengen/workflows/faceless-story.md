---
title: Faceless story
summary: Narrated story told over a sequence of AI images (storyboard, whiteboard or hand-drawn look). The workhorse format.
default_style: storyboard
---
## start
Ask (or decide) the topic, target length (30, 45 or 60 s), visual style (storyboard, whiteboard, hand-drawn, cinematic) and voice. Call `list_voices` and `list_caption_styles` if the user has no preference.

## script
Write the narration yourself; do not call a tool.
- Line 1 is the hook: ≤ 12 words, a question, a surprising fact or a stakes statement.
- 6–10 scenes, one sentence each, ~2.6 spoken words per second of target length.
- The last scene pays off the hook, then a one-line call to action.
- Write an `image_prompt` per scene describing a concrete visual (subject, action, setting, framing). Keep a recurring character described the same way in every prompt.

## visuals
Call `estimate_cost` with the planned scenes. Then call `compose_video` with:
- `scenes`: [{narration, image_prompt}] in order
- `style`: the chosen style preset
- `voice`: {provider, voice}
- `caption_style`: "bold" unless asked otherwise
Then `wait_for_job` until it succeeds.

## publish
Call `preview_media` at 1 s and at the midpoint to check the frames. Report the file path and suggest a title (≤ 60 chars), 3 hashtags including #Shorts, and a description. Posting is manual: this server does not upload.
