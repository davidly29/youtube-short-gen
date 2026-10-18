---
title: 3D explainer
summary: Stylised 3D visuals explaining how something works, one concept per scene.
default_style: 3d
---
## start
Pick one question ("How does a jet engine work?"). Target 45–60 s. Confirm the audience level.

## script
- Hook: the question or a counter-intuitive fact.
- One mechanism step per scene, in causal order. Avoid jargon or define it in the same sentence.
- End with a one-line summary of the whole mechanism.
- Image prompts describe a clean 3D object or cutaway on a plain background.

## visuals
`compose_video` with `style: "3d"`, `caption_style: "boxed"`, voice speed 0.95.

## publish
Preview the middle frame to confirm diagrams match narration. Suggest a title that is the question itself.
