# 27 · Profile once. Check every pull request.

`step: ci-profile-once` · Keeping the bugs out · **18:30 → 19:15** (0:45)

**On screen:** “Check behaviour and counts, not milliseconds,” two rules from the two investigations, 3 / 3 locally.
**Purpose:** show both fixed bugs returning six months later, unnoticed by the reports. That motivates a check on every PR. Main rule: check behaviour and counts, not milliseconds.

## Script

Both bugs are fixed. But a fix only lasts until the next refactor.

Six months later, someone moves the page to a custom server and loads the script as a normal module. Someone writes a new screen and forgets the cleanup in `useEffect` again. Neither report will catch it. Lighthouse gives a hundred again. React Profiler still sees no renders from the closed screen.

The profile explained the cause once. To keep it from coming back, we need a check on every pull request.

What we check matters. Not milliseconds. Timing on CI machines is noisy. A test that says “no more than twelve milliseconds” will pass one day and fail the next, and after a week someone will disable it. Check behaviour and counts: “the early click sorted the list,” “zero subscriptions after the screen closes.” Those don’t have the same timing noise.

We tested both checks just as we did on the web: against the broken version, they fail three times out of three. Against the fixed version, they pass three out of three. Locally, so far.

## Transition

> Here’s what they look like. Three lines each.
