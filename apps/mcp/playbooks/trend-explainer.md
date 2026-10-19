---
slug: trend-explainer
title: Trend explainer
summary: Explain what is rising in the user's niche and why it matters, in 30-45 seconds.
---

# Trend explainer

## start

1. Ask the user for their niche if you don't know it, then call `get_trends` with it.
2. If trends are unavailable (it says so until the trend radar launches), ask the user for a topic instead. Never invent a "trending" claim.
3. Offer the user 2-3 angles on the topic (what happened, why now, what it means for the viewer) and let them pick one.
4. Call `get_credit_balance` (or `estimate_cost`) and tell the user it uses 1 Short.

## script

- Shape: hook (a surprising fact or question, at most 12 words) -> what is happening -> why now -> what it means for the viewer -> call to action.
- 4-8 beats, one idea per beat. Aim for 2.6 spoken words per second of the chosen length (45 s is about 115 words).
- Write it fresh in the user's voice; don't copy anyone's script or titles. Mark anything you aren't sure is true with [verify] and ask the user to confirm it before you continue.
- Pass your script as `script` to `create_short`, or leave it out and pass the angle so ShortLoop writes it with the user's AI key. Use length_seconds 30 or 45.
- Optional: `list_voices` and `list_caption_styles` to let the user choose a voice and caption look.

## visuals

1. Give every beat a concrete visual description (objects, places, charts, no real people's faces, no logos).
2. After `create_short`, call `wait_for_job` until done is true (call again if it isn't), then show the user the video link.
3. If a shot looks off, call `swap_visual` with the 1-based shot number and a better prompt, then `wait_for_job` again.

## publish

1. Only after the user has watched the Short and said yes, call `approve_short`.
2. Suggest a title (at most 100 characters) and a two-line description; let the user edit them.
3. Call `publish_short` (ask whether to publish now or schedule), then `wait_for_job` and give the user the YouTube link.
4. Never publish without the user's explicit OK.
