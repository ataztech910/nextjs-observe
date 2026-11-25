# 25 · The screen is closed. Its handlers are not.

`step: rn-subscription-fix` · RN: the screen is gone, the work continues · **16:50 → 17:40** (0:50)

**On screen:** chart: visits on the horizontal axis, JS time per update on the vertical axis. Orange bars without unsubscribe: 0.45 → 4.3 → 12.4 ms, averaged over 4 Release runs. White dots are individual runs. Green bars are after the fix, near zero. Dashed 16.7 ms line is a 60 Hz frame reference.
**Purpose:** show the cost of the bug and the fix in one picture. Return to the shopper: the person who checks orders most often accumulates the most unnecessary work. Clearly state that tap latency was not measured.

## Script

Here’s the cost of that mistake. *(follow the orange bars)* How much JavaScript runs per update when all the screens are closed.

After one visit, less than half a millisecond. After ten, four. After thirty, just over twelve. Release build, four runs, these are averages.

Same screen, closed in the same way. Only the number of visits grows. So the most unnecessary work builds up for the most active shopper—the person who checks their order most often.

Now the fix. Return a function from `useEffect` that unsubscribes the handler. One line. *(point to the green bars)* Same experiment: zero subscriptions, zero calls, time near zero, at every visit count.

Why does this matter to the user? JavaScript in React Native runs on one thread. While these handlers run, everything else on that thread waits—including processing a tap, if it arrives at that moment.

But to be clear, this chart does not show tap latency. We measured unnecessary JS work, not how much later the shopper saw a result. The dashed line at 16.7 milliseconds is a frame duration for reference, not a threshold we used to count anything.

## Transition

> We found it in the lab. How would we spot it for real users?

## If asked

At 30 visits, the per-run means range from 11.7 to 13.1 ms; the maximum individual event was 19.8 ms. “Near zero” includes iterating over an empty collection and measurement overhead. Native frames and animations were not measured. Source: research/06-rn-subscription-pilot.md.
