# 30 · Which tool answers which question?

`step: toolkit-map` · Resolution · **20:45 → 21:35** (0:50)

**On screen:** seven-row table: question → tool → what it sees → what it misses → where. Flashlight is dimmed because it was not demonstrated today.
**Purpose:** do not read the table. Retell the talk as a chain: each tool honestly answered its question, and what it could not see told us which tool to open next. Be explicit about Flashlight.

## Script

Look at the order in which we opened the tools today. *(point to the map)*

Lighthouse said loading was fine. It knew nothing about the click, so we added our own marks. The marks showed that the code was late, but not why, so we opened Chrome DevTools. DevTools showed the order: click first, code later. It didn’t tell us whether sorting worked, so we checked that with our marks again.

Same on mobile. React Profiler said the closed screen wasn’t rendering. It knew nothing about JavaScript outside rendering, so we opened Hermes. Hermes showed sorting, but not how many times it ran. We needed a counter. OpenTelemetry carries that counter into observation of real users. It doesn’t decide which number to send for us.

Every tool honestly answered its own question. Every time, what it couldn’t see told us which tool to open next.

There’s one row in the table I didn’t demonstrate today: Flashlight. Frames, CPU, and memory for a scenario on Android. Our experiments ran in Chrome and the iOS Simulator, so I didn’t run it.

## Transition

> All that’s left is to return to the page we started with.
