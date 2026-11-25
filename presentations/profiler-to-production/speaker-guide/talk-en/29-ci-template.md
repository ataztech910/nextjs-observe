# 29 · Take the template

`step: ci-template` · Keeping the bugs out · **20:00 → 20:45** (0:45)

**On screen:** performance-checks.yml—one workflow on pull_request, two checks. Caption: validated locally, not yet run on GitHub.
**Purpose:** fulfil the opening promise: how not to lose that click in the next release. Share the template, but emphasise the habit: turn your last bug into a check. Connect CI with observation after release.

## Script

At the start, I promised to show how to avoid losing that click in the next release. Here’s the answer. *(point)*

One folder, one workflow, two checks. Copy the folder into your repository, put the workflow in `.github/workflows`, and the checks run on every pull request. For React Native, it’s the same hook check, using Testing Library for React Native.

I’ll share the template link on LinkedIn and on my website. The QR codes are at the end.

But the template isn’t the main thing. The habit is. Think of the last performance bug you fixed. Find a behaviour or a counter in it that should remain correct. Turn that into a check.

After release, send those same counters through OpenTelemetry, broken down by version and session length. CI catches what we can reproduce before release. Observation catches what CI didn’t reproduce. The thirtieth visit in a long session, for example.

To be clear, the workflow has been checked locally. It hasn’t run on GitHub yet.

## Transition

> We opened quite a few tools today. Let me put them on one map.
