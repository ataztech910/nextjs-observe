# Experiment A — matched navigation and post-load interaction

The separate `performance-observability` repo now implements A on a dedicated `/a.html` entry. Observe exports
app-owned OTel; the existing backend owns OTLP capture/replay; Observer displays `observe.scenario-report/v1`.
No monorepo runtime or instrumentation API change is required. The web bootstrap accepts an app-local optional
experiment/source identity; existing C defaults stay intact and its browser smoke passes on the new shared build.

## Frozen protocol

- Lighthouse 13.6.0, Chrome launcher 1.2.3, web-vitals 6.2.3, source-map decoder 0.3.31; pinned dependencies/lockfile.
- Four matched blocks: eight primary conditions, baseline/degraded order alternating to balance positions. Three
  trusted post-load clicks each, zero warmup exclusions; first click retained separately. Compare run medians.
- One shared production-profiling build and identical initial content. Selected work is absent at mount and deferred
  until a click: 16 versus 6000 redundant passes, same deterministic output. Strict Mode/compiler are off.
- Fresh Chrome/profile for each navigation and interaction phase; same executable, UA, flags, 1280×800 desktop/DPR 1.
  CPU/network throttling not requested. Lighthouse uses provided desktop scoring, not simulated mobile scoring.
  Server/filesystem caches are not flushed; host thermal/power state are unmeasured. This is one local Mac study.
- Load initializes the same diagnostic SDK but skips capture-control creation and never clicks. Load audit and later
  interaction are separate matched pages/processes, not one shared page lifecycle. Interaction begins after app ready
  plus 1000 ms, with 250 ms gaps. Lighthouse collection overhead is part of load audits in both conditions.
- Two extra CDP timeline/CPU diagnostic pages are excluded from primary score/interaction comparison. Source maps
  resolve sampled minified functions to `src/load-workload.ts`. RunTask and timing marks stay in CDP trace time;
  no invented alignment with OTLP epoch timestamps or exact CPU-duration interpretation.

Predeclared descriptive criteria: every paired score difference ≤5 points; every score ≥90/100; every paired
run-median handler→commit gap ≥50 ms. A failure yields demonstrated=false, not missing data or forced confirmation.
Observer passed means the external runner validated evidence/completion, not that a performance hypothesis is true.

## Distinct measurements

App samples retain trusted input timestamps, handler start, selected callback span, Profiler render-work scalar and
commit callback. Endpoint: `handler-start-to-profiler-callback (not paint/INP)`. Render and selected work overlap.

Raw Event Timing (16 ms threshold), Long Tasks and LoAF retain browser source/time origin/capability/loss metadata.
A bounded source overflow or unexpected backgrounding rejects collection. Unsupported sources remain unavailable;
zero is only used for an actually observed empty supported population. Event Timing is thresholded, not every input.

web-vitals/onINP receives actual Event Timing. After SDK/capture finalization the page navigates to about:blank;
actual visibilitychange-hidden sends a loopback lifecycle beacon. There is no synthetic hidden event. Final values
are associated by run and time origin; no eligible value stays null, never substituted with a handler duration.
These are three-click lab page-lifecycle INP observations, not field Core Web Vitals.

## Actual result

Final session: `reports/load-a-1794560947170-6c40`, Chrome 157 on this Mac. All eight navigation reports scored 100/100.
All three nominated action results match across variants. There are eight primary interaction pages × three actions,
plus six diagnostic actions, all retained with 6 spans/3 final histogram points per interaction page.

| Variant | Four run medians, handler→commit (ms) | Page-lifecycle INP (ms) | Long Tasks / LoAF per page |
| --- | --- | --- | --- |
| baseline | 1.6, 2.2, 2.2, 2.2 | 16, 16, 16, 16 | 0 / 0 |
| degraded, in block order | 215.8, 203.0, 215.5, 215.8 | 296, 224, 216, 232 | 3 / 3 |

Every matched handler median gap is positive: 214.2, 200.8, 213.3, 213.6 ms; score gaps are all zero. The predeclared
local descriptive criterion is demonstrated. This does not establish a population effect or imply Lighthouse is
incorrect: the expensive work was deliberately deferred beyond navigation.

Independent diagnostic pages: baseline/degraded have 149/164 main-thread RunTask observations, max task 6.891/216.968 ms,
905/1403 CPU samples, and 4/490 samples mapped to the selected workload source. These profiled timings are excluded
from primary distributions. Original traces, profiles, source maps, markers and source mapping are preserved; they
corroborate the selected work without replacing app or browser metric definitions.

## Preservation and verification

The session retains exact source/build/lock/tool snapshots and hash inventory, protocol/schedule/environment/backend
identity, all Lighthouse JSON/raw metrics and representative navigation traces/devtools logs, original samples/lifecycle
beacons, raw OTLP, diagnostic trace/CPU/source-map evidence, deterministic analysis JSON/HTML/screenshots, Observer
report/content-addressed structured attachments, and browser verification. Larger traces remain external artifacts.

49 JS tests and 8 Python tests pass; typecheck/build pass. Four focused mutations were caught: ignore throttling,
fabricate INP from handler time, force hypothesis confirmation, and attribute unrelated source frames to selected work.
Code was restored before final collection. Six corruption checks on a temporary copy reject changed Lighthouse,
sample/lifecycle bytes, source map, OTLP body and missing run membership. Original frozen evidence is untouched.

Replay checks every source/build artifact, protocol/implementation/backend identity, run association, raw OTLP,
source/context/metric population and recomputes diagnostic mapping. Analysis JSON is byte-identical, SHA-256:
`35f4c6c3402c652fea10a4e3d39b4726ef3cb42d442ae1447ce3da7fba0ce02f`.

Packed Observer browser verifies all ten result rows and reports no page errors. The standalone analysis screenshot
was inspected. C regression `web-scenario-1794561202710-7ff5f9` passes on the same new build with its original checksum /
6-span / 3-metric-point contract. Earlier frozen C/native sessions are untouched. The two-block A pilot remains separate.
Packed dependencies use the installed graph via symlink, not a clean-install check. No native build/device claim is
made in this web-only step.

## Commands and next step

From the experiment repo (Node 24, Chrome installed):

```sh
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/merged/packed-observer/package npm run experiment:a -- --blocks 4
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:a -- reports/<session>
```

Full procedure/limits: experiment repo `EXPERIMENT_A.md`. The saved Observer report is served separately on :4324;
existing web/native viewers remain on their own ports. Temporary measurement/browser/receipt servers close after runs.
Next is B: declare a size-comparability tolerance, preserve actual bytes/transfer/cache evidence, and compare repeated
startup/readiness/execution distributions. Native physical presentation and D/E/F gates remain independent/open.

Primary references: [Lighthouse scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring),
[Lighthouse Node API](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md),
[web-vitals](https://github.com/GoogleChrome/web-vitals), [Event Timing draft](https://w3c.github.io/event-timing/).
