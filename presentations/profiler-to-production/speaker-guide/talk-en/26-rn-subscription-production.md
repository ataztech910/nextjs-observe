# 26 · Watch the count over the session

`step: rn-subscription-production` · RN: the screen is gone, the work continues · **17:40 → 18:30** (0:50)

**On screen:** session chart: screen visits on the horizontal axis, active subscriptions on the vertical axis. Without unsubscribe: +1 per visit. With unsubscribe: 0.
**Purpose:** explain why the bug survives until release: tests open the screen only once. Explain which signal would catch it for real users: a counter over the session, not the duration of one update. Close the RN case with a sentence connecting the tools.

## Script

Why does a bug like this survive until release? Because the test opens the screen once. One subscription, half a millisecond—nothing stands out. The bug grows with each visit. You see it in a long session, with that very active shopper.

So after release, we watch the count over the session, rather than the duration of one update. How many subscriptions are active? How many times was an event delivered? Compare that with the expected state: no orders screen means zero subscriptions.

Break those numbers down by app version and stage of the session. Then the question after release is simple: does the new version leave subscriptions behind when screens close? The aggregates go through OpenTelemetry to any compatible backend.

**[Add your own sentence here about how this pattern looks in Dynatrace.]**

To be clear, this is a proposal. I haven’t validated this signal in production yet. And we have the exact subscription count because we own the event source. For a third-party library, we would have to count subscriptions and unsubscriptions ourselves.

So, for the mobile case: the profiler showed where the time went. The counter explained why there was so much of it. Repeating the experiment verified the fix. Before making the work faster, we needed to ask whether it should be happening at all.

## Transition

> Two bugs found and fixed. Now we need to keep both out of the next PR.

## If asked

OTLP delivery and alerting were not tested in this RN experiment. There is no universal way to access AppState’s internal listeners or those of an arbitrary library. Do not promise one.
