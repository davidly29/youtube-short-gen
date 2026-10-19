---
slug: myth-vs-fact
title: Myth vs fact
summary: Bust one common misconception with a clear, checkable correction.
---

# Myth vs fact

## start

1. Ask the user for a topic, or call `get_trends` for their niche; if trends are unavailable, ask the user for a topic.
2. Agree one myth that many people believe and that has a clear, well-established correction. Skip anything medical, legal or financial unless the user accepts a "not advice" line in the Short.
3. Check credits with `get_credit_balance` or `estimate_cost`.

## script

- Shape: hook stating the myth as a question (at most 12 words) -> why people believe it -> the fact -> the evidence in plain words -> a one-line takeaway -> call to action.
- 4-7 beats, one idea per beat, 30 or 45 seconds (about 2.6 spoken words per second).
- The correction must be something the user can check. Mark anything uncertain with [verify] and confirm it with the user before rendering.
- Don't quote named real people and don't mock anyone who believed the myth.
- Pass the script as `script` to `create_short`, or pass the topic plus the angle "myth vs fact: <myth>" and let ShortLoop write it.

## visuals

1. Use a visual contrast: the myth beats show the common picture, the fact beats show the real one (diagram, close-up, object).
2. Call `wait_for_job` until done is true, then show the user the video link.
3. Use `swap_visual` for any shot that could be read as supporting the myth, then `wait_for_job` again.

## publish

1. Only after the user has watched it and said yes, call `approve_short`.
2. Title pattern: "Myth: <myth>?" or "<myth>? Not quite." (at most 100 characters). If the Short corrects a factual claim, put one source link in the description.
3. Call `publish_short`, then `wait_for_job`, and give the user the YouTube link. Never publish without the user's explicit OK.
