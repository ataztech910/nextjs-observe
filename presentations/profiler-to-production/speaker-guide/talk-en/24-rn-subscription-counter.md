# 24 · One update. Thirty callbacks.

`step: rn-subscription-counter` · RN: the screen is gone, the work continues · **16:00 → 16:50** (0:50)

**On screen:** 1 visit → 1 subscription → 10 calls; 10 → 10 → 100; 30 → 30 → 300. Below: useEffect code with the unsubscribe line missing.
**Purpose:** a simple counter answers the question the profile did not: how many? Return to the useEffect from slide 21 and show the missing line. Explain why optimising sorting would have been the wrong fix.

## Script

The counter is very simple: how many handlers are subscribed to updates right now?

We played the shopper once: one. Ten times: ten. Thirty times: thirty. Number of open screens: zero.

So one update calls thirty handlers. Ten updates mean three hundred calls. Each one sorts its own five hundred orders. For a list nobody can see.

Now let’s return to the `useEffect` I asked you to remember. *(point to the code)* It has `listeners.add`. But there’s no line that unsubscribes. The screen closed; the subscription stayed. Every visit added another one.

That’s why speeding up the sort would have been the wrong fix. Make it twice as fast and we still have thirty unnecessary handlers. Faster, but just as pointless.

And Hermes couldn’t tell us that: thirty copies of the same handler look the same in the profile. The number thirty came from the counter, not the profiler.

## Transition

> The fix is one line. Let’s see what it changes in the numbers.
