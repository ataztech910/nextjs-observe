# 17 · How could we see this after release?

`step: web-streaming-observability` · Web: the button is there, the code is not · **10:50 → 11:40** (0:50)

**On screen:** local pilot pipeline: early HTML handler → JSON receiver → Node OTel SDK → OTLP receiver. At the bottom: attempts without a confirmed outcome remain “unknown.”
**Purpose:** take the investigation from the lab to real people, and encounter a trap: the usual telemetry code starts with the application and misses the same click. Show how the pilot avoids this, and explicitly name the unknown outcome.

## Script

In production, I don’t have Playwright or a stopwatch. I only have code running on the user’s device and sending something back. Exactly what I work on in my day job.

And there’s a trap. Usually, that code is loaded with the application. So it starts at the same time as the application—three seconds later. It misses the early click just as the button did. We’d fail to see the problem at the very point where it happens.

So in the pilot, we placed a small handler directly in the HTML, before React. It records the attempt: someone clicked. Then it waits for confirmation that the correct order has appeared on the page.

The report goes from the browser to a receiver, then through OpenTelemetry to an OTLP receiver, where the rest of the telemetry goes too. We ran that whole pipeline locally, six times. The data matched.

One detail that’s easy to forget: if someone clicks and immediately closes the tab, we may receive the attempt but never receive the outcome. That isn’t success or failure. It’s unknown. We need to count it that way.

## Transition

> Now we can see the lost click. Next, we need to make sure the next release doesn’t bring it back.

## If asked

This is a local pilot, not a production SDK. The 1.2 s confirmation window was chosen for the experiment; it is not a UX budget. Real use requires work on CSP, overhead, delivery, precise correlation, and a baseline. Sources: research/01-early-observability.md, research/01-action-signal.md.
