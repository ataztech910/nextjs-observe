# 04 · The report looks fast. What did the user experience?

`step: performance-question` · Why this happens · **1:40 → 2:20** (0:40)

**On screen:** heading and four lines explaining that different observations describe different parts of the application. Do not read the lines aloud.
**Purpose:** answer “Is the page fast?” with two honest answers, yes and no. Show that the disagreement is about the question, not the numbers. Do not reveal why the button does nothing.

## Script

If you ask Lighthouse, yes, it’s fast. A hundred points, content in two tenths of a second.

If you ask the person who clicked “Price: low to high,” no.

This is not an argument about who’s right. Lighthouse was answering, “How quickly did the page appear?” The person was asking something else: “When will I see the result of my click?” That moment simply isn’t in the report. Lighthouse doesn’t click buttons.

And this doesn’t happen only during loading. A page can appear before its button works. A list can scroll smoothly while a tap on an item gets stuck.

So from now on, before looking at any number, I’ll ask one question: which user question does it answer?

## Transition

> For the user, “fast” actually means three different kinds of waiting.
