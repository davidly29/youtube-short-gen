---
slug: top-3-list
title: Top 3 list
summary: Three ranked items on one theme, counting down to the best one.
---

# Top 3 list

## start

1. Ask the user for a theme (e.g. "3 ocean animals with superpowers"), or call `get_trends` for their niche and turn a trend into a theme; if trends are unavailable, ask the user.
2. Agree the three items and their order with the user. Avoid ranking real people or brands.
3. Check credits with `get_credit_balance` or `estimate_cost`.

## script

- Shape: hook naming the list (at most 12 words) -> number 3 -> number 2 -> number 1 (the strongest) -> call to action.
- One or two beats per item, 5-8 beats in total, 45 or 60 seconds (about 2.6 spoken words per second).
- Each item gets one concrete, surprising detail. Mark anything uncertain with [verify] and confirm it with the user.
- Pass the script as `script` to `create_short`, or pass the theme with the angle "top 3 countdown" and let ShortLoop write it.

## visuals

1. One clear subject per item, described concretely; start each item's first beat with its number in the text so the captions show it.
2. Call `wait_for_job` until done is true, then show the user the video link.
3. Use `swap_visual` for any shot that doesn't show its item, then `wait_for_job` again.

## publish

1. Only after the user has watched it and said yes, call `approve_short`.
2. Title: "Top 3 <theme>" style, at most 100 characters; list the three items in the description.
3. Call `publish_short`, then `wait_for_job`, and give the user the YouTube link. Never publish without the user's explicit OK.
