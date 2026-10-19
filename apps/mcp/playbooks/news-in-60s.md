---
slug: news-in-60s
title: News in 60 seconds
summary: One news story told accurately in under a minute, with at least two cited sources.
---

# News in 60 seconds

## start

1. Ask the user which story to cover, or call `get_trends` for their niche; if trends are unavailable, ask the user for the story.
2. Collect at least 2 independent source URLs for the story (from the user, or reputable outlets you can read). Without 2 sources, stop and tell the user this format needs them.
3. Check credits with `get_credit_balance` or `estimate_cost`.

## script

- Shape: hook with the news in at most 12 words -> what happened -> who it affects -> why it matters -> what happens next -> call to action.
- 5-8 beats, 45 or 60 seconds (about 2.6 spoken words per second).
- Every factual claim must come from the sources. Never present an unsourced claim as fact; mark anything you can't source with [verify] and drop it if the user can't confirm it.
- Don't quote named real people; describe what they said in your own words and attribute it to the source ("according to <outlet>").
- Neutral tone: no speculation presented as fact, no opinions the user didn't ask for.
- Pass the script as `script` to `create_short` (preferred for news, so the facts are the ones you checked). Use length_seconds 45 or 60.

## visuals

1. Use explanatory visuals (maps, objects, places, simple diagrams). No real people's faces, no news-channel logos, no screenshots of articles.
2. Call `wait_for_job` until done is true, then show the user the video link.
3. Use `swap_visual` for any shot that could mislead (e.g. looks like real footage of the event), then `wait_for_job` again.

## publish

1. Only after the user has watched it and said yes, call `approve_short`.
2. The description you pass to `publish_short` must cite at least 2 sources: a "Sources:" line followed by each source URL (outlet name and link). Don't publish with fewer than 2 sources.
3. If any shot looks like realistic footage of the real event, turn the AI label on in `publish_short`.
4. Call `publish_short`, then `wait_for_job`, and give the user the YouTube link. Never publish without the user's explicit OK.
