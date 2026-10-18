---
title: Animal story
summary: Emotional short story starring one animal character, with a hook, a struggle and a payoff.
default_style: cinematic
---
## start
Pick one animal protagonist and one emotional arc (lost and found, underdog wins, unlikely friendship). Target 45 s.

## script
- Hook scene shows the animal in trouble or doing something unexpected.
- 6–8 scenes: setup, struggle (2–3 scenes), turning point, payoff, closing line.
- Describe the animal identically in every `image_prompt` (species, colour, one distinctive mark) so it stays recognisable.
- Narration is warm, present tense, short sentences.

## visuals
`compose_video` with `style: "cinematic"`, `caption_style: "karaoke"`. For moving shots set `video_prompt` instead of `image_prompt` on 1–2 key scenes when a fal key is configured; otherwise images with Ken Burns motion are used.

## publish
Preview, then give title options that name the emotion ("This penguin refused to give up").
