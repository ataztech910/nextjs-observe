# 23 · Hermes: the sort is expensive. Optimize it?

`step: rn-subscription-hermes` · RN: the screen is gone, the work continues · **15:20 → 16:00** (0:40)

**On screen:** actual Hermes profile screenshot: onOrderUpdate → arrayPrototypeSort, a 20 ms window around an update.
**Purpose:** find the work missing from the React tree: the closed screen’s handler sorts orders. Follow the temptation to optimise sorting, just as the web team wanted to shrink the bundle, then stop: the profile answered “where,” but not “why” or “how many times.”

## Script

Hermes records which JavaScript is running by taking samples many times a second. Here’s the moment an update arrives. *(point)*

`onOrderUpdate`. Under it, `arrayPrototypeSort`.

That’s the handler from our orders screen. The screen is closed, React isn’t drawing anything, but the handler is running and sorting five hundred orders.

There’s the work we couldn’t see in the component tree.

And now it’s tempting to do what the web team wanted to do with the bundle: optimise whatever we can see. Sorting is expensive, so let’s make it faster. A different algorithm. Memoisation. Sort less often.

But the profile only answered “where.” It didn’t explain why this code is running at all when the screen is gone. Or how many times it runs for one update.

## Transition

> For that, we don’t need a profiler. We need a counter.

## If asked

This is a Debug sampling profile, focused on the 37.142–37.162 s window and the onOrderUpdate subtree. Individual samples are not calls or a subscriber count. Do not compare the screenshot’s timings with the Release numbers.
