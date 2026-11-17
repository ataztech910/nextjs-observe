# Conference demonstration plan

> **Status — 17 November 2026:** This evidence-only draft does not yet fulfill the fixed conference description. The [fixed brief and delivery requirements](CONFERENCE_BRIEF.md) govern acceptance and the replacement main route. RN before/after, startup/hydration, named tool workflows and regression prevention require additional work; the earlier “no new measurements required” scope is superseded. Existing results retain their original limits.

Preferred visual version: [copied workshop graph engine](../../../presentations/profiler-to-production/graph/README.md), on its own port 4349. The original `workshop-slides` is unchanged; the flat deck below remains the print fallback.

Visual version: [separate offline slide deck](../../../presentations/profiler-to-production/index.html), with notes and audience-only PDF printing. [Controls and rebuild instructions](../../../presentations/profiler-to-production/README.md).

Editorial companion: [slide copy and speaker notes](CONFERENCE_SLIDES.md), with eight core slides and two optional appendices. The total slot is 30 minutes; the [run of show](CONFERENCE_RUN_OF_SHOW.md) allocates 25 minutes presentation and 5 minutes Q&A.

Working proposal after merge #115 (`d6ac3ab`), 14 November 2026. This selects a bounded story from existing
local evidence for **From Profiler to Production: Measuring What Actually Matters in React & React Native**.
Updated timing, 15 November: the speaker confirmed 30 minutes total; our working split is 25 minutes presentation and 5 minutes Q&A. It does not declare all A–F
accepted, a product overhead budget, production generality or physical native presentation. No new measurements
or Observer features are prerequisites for this version of the story. The speaker can change this scope before
freezing slides; a stronger claim requires its own declared measurement contract first.

## Selected claims and screens

The four evidence scenes use 15 minutes 30 seconds inside the 25-minute main route, including saved-report transitions; the other slides use 9 minutes 30 seconds. Show frozen reports
rather than trying to reproduce timing live. Display the session ID and the measurement endpoint on each slide.
The actual original protocols and limitations remain authoritative; these are speaker cues, not replacement analyses.

| Scene / suggested time | Screen and original evidence | Claim to say aloud | Boundary to keep on screen |
| --- | --- | --- | --- |
| A / 4 min | [A gate](EXPERIMENT_A_GATE.md), `load-a-1794560947170-6c40`: load scores, paired handler-to-Profiler run medians and separate lifecycle INP. | “In this controlled local case all eight navigation scores were 100, while the deliberately deferred work increased each paired handler-to-commit median by 200.8–214.2 ms.” | Four primary matched blocks on one unthrottled Mac; load and post-load endpoints differ. Three-click lab lifecycle INP is separate from handler duration and field INP. Diagnostic profiles are excluded from primary timing. |
| B / 4 min | [B gate](EXPERIMENT_B_GATE.md), `bundle-b-1794566743221-443a`: matching artifact/response bytes, selected compute and navigation-to-first-layout-effect. | “The same downloaded JS performed different configured startup work. Equal bytes did not imply equal execution or readiness in this fixture.” | One artifact, different configuration; not two different equal-size bundles. Selected compute, startup wall and presentation are distinct. Gzip was served; Brotli is artifact-only. |
| F delivery / 4 min | [Trace fault gate](F_PIPELINE_GATE.md), `pipeline-1794641370737-5d72`: healthy, overflow and HTTP400 rows. Show [metric fault gate](F_METRIC_DELIVERY_GATE.md), `metric-1794646414485-258d`, if useful for the retry/flush question. | “A report must preserve failed and incomplete delivery. A completed validation session or resolved flush does not prove every record arrived.” | Trace overflow stays incomplete with 20 deliberate queue drops; trace and metric HTTP400 stay failed. These are controlled fault cases, not production loss rates. Cumulative metric checkpoints are not additive. |
| F cost / 3 min 30 s | [Stripped build gate](F_STRIPPED_STUDY.md), `stripped-1794680848671-8f54`: loaded versus emitted bytes, adapter-ready endpoint and work CPU uncertainty. | “In these two builds, loaded gzip JS was 1871 B stripped and 8275 B with Observe installed but disabled. Readiness and work CPU answer different questions.” | Six local alternating run pairs, two build artifacts. Adapter-ready wall difference is +21.433 ms [1.450, 44.650] under the original exploratory interval; work-CPU interval spans zero. No general acceptable-overhead, equivalence, speedup or pure probe CPU claim. |

For A/B, open both primary measurements and diagnostic source evidence if asked where the work occurred.
Do not turn a selected source match into complete automatic hook attribution. For F cost, retain all contrasts and
uncertainty in the original attachment even if the slide shows only bytes/readiness. Do not select a favorable run,
subtract across studies or add overlapping phase durations. The [F matrix](F_EVIDENCE_MATRIX.md) and
[index](F_EVIDENCE_INDEX.json) preserve all ten protocols and their distinct scopes.

## Coverage of the six experiments

| Experiment | Role in this proposed talk | Further evidence needed for a stronger claim |
| --- | --- | --- |
| A | Core local comparison, as above. | Field/device generality and a broader production claim require a target protocol. |
| B | Core same-artifact/configured-work comparison. | Comparing different equal-size bundles needs its own declared comparability and parse/execution protocol. |
| C | Supporting instrumentation walkthrough: [manual selected hook work](REACT_HOOK_INSTRUMENTATION.md) and [Playwright functional report](SCENARIO_REPORTS.md), `web-scenario-1794566774159-a535ac`. Show selected source, explicit interaction context and three committed actions. | This single baseline smoke is not before/after statistical acceptance. Full C optimization claims must use a declared repeated comparison and its actual result; Profiler completion is not paint. |
| D | Optional Simulator appendix: [native callback cadence](IOS_NATIVE_CADENCE.md) and [system recording](IOS_SYSTEM_PROFILER_GATE.md); optional [Maestro](MAESTRO_GATE.md) success/failure reports below. | Physical Release execution, calibrated source/clock limits and independent presentation/deadline evidence before saying “smooth FPS while JS is blocked.” |
| E | Explain the missing observation and next experiment; no claimed native-jank result. | A validated native degradation source, independently recorded frame/hitch evidence and a predeclared JS responsiveness comparison. Simulator hitch unavailability must stay unavailable. |
| F | Core scoped delivery and build-cost examples; other F protocols available for questions. | A declared budget/decision rule and only the target-specific missing sources/workload conditions needed for a product acceptance claim. Full F remains open. |

The original central hypothesis is a research question, not a theorem proven across all React/RN apps. The observed
fixtures show why distinct sources and endpoints matter. Native callback collection can continue during selected
JS work on this Simulator; that does not establish presented frames. In the retained system gate, Animation Hitches
was unsupported, so its count/ratio are unavailable. Time Profiler/signposts are diagnostic corroboration, not an
independent compositor sensor or a measurement of instrumentor overhead.

Optional native runner evidence: `maestro-1794559097407-1a14dc` is passed; `maestro-1794559119640-609fd2` is failed
because of the deliberate UI completion assertion. Both telemetry archives are finalized. This demonstrates why
runner outcome and archive finalization are separate. Maestro action duration is not application CPU/input latency.
The retained `ios-cadence-1794441662289` and `ios-system-1794455821579` sources are described by their linked gate docs;
they are not replaced by the later Maestro runs.

## Open the evidence without collecting new timings

Run each viewer from the sibling `performance-observability` repository with Node 24 and the matching retained
packed backend. Original raw sessions and tracked experiment commits are local; that repository has no remote.
A checkout of these monorepo docs alone cannot recreate the evidence. Preserve complete sessions, including raw
captures, sources/builds/maps/locks, protocol, reports and hash-addressed attachments. The backend used for this
rehearsal is packed 0.3.35 with the installed dependency graph reused by symlink, not a clean installation.

Example for A, using a free loopback port (4340 is an example, not a reserved service):

```sh
OBSERVER_PACKAGE_ROOT=/absolute/path/to/matching/packed-observer/package \
CAPTURE_DIR=reports/load-a-1794560947170-6c40/captures \
PERFORMANCE_REPORT_DIR=reports/load-a-1794560947170-6c40/observer-reports \
OBSERVE_PORT=4340 npm run collector
```

Open `http://127.0.0.1:4340/performance?report=load-a-1794560947170-6c40`.
For B/C/native, substitute the exact session ID above in both paths and the report query, then use another free port.
For F, either use the same per-session recipe or the two existing audit shelves:

| Saved local viewer | Report query to select |
| --- | --- |
| `http://127.0.0.1:4336/performance` | `?report=pipeline-1794641370737-5d72` or `?report=metric-1794646414485-258d` |
| `http://127.0.0.1:4337/performance` | `?report=stripped-1794680848671-8f54` |

Those processes may need restarting. Shelf paths/restart instructions are in the sibling
[F evidence note](../../../../performance-observability/F_EVIDENCE.md). They contain 98 and 42 captures respectively,
within the existing 100-run list bound. Do not combine all 140 F captures into one archive-list directory.
The stock collector process enables ingestion as well as viewing: use dedicated frozen-session copies for rehearsal
if telemetry producers could target it, and do not point a running app at the original evidence viewer. No new
receiver, upload flow or frontend instrumentation is needed.

## Rehearsal acceptance and fallback

Before presenting, check the selected report ID, exact original row states, declared endpoint and unavailable reasons.
Wait for both archive list and report to finish loading; check visible alerts as well as browser errors. Inspect the
fault rows explicitly. A screenshot of a healthy first row alone cannot verify overflow/rejection. Confirm that
attachments and raw source artifacts remain available locally; a report checksum verifies integrity/association,
not scientific acceptance. Keep the native functional report outside the web performance comparison.

If the viewer or local artifacts are unavailable, use retained original screenshots/analysis only with the original
session ID and endpoint visible. Do not invent replacement values, re-label unsupported values as zero, or start a
new timing run during the talk to repair a missing artifact. If neither original report nor original screenshot is
available, omit that result and explain the measurement model. Fresh benchmarks are a separate predeclared protocol.

Observe/app instrumentation supplies the observations; the external harness runs Playwright/Maestro, acquires
independent sources and computes the analyses; the backend collector/archive receives and stores OTLP; Observer
presents those reports. End with this boundary and the next unmeasured endpoint, rather than a claim that all A–F
or production overhead are now accepted.

## Preparation verification — 14 November

A fresh packed-reader/Chrome rehearsal opened the eight named A/B/C/trace/metric/stripped/Maestro-success/Maestro-failure
reports, validated their original report/capture/artifact associations and displayed all 44 original row states and
explicit unavailable values. Selected report IDs, loaded archive lists, visible alerts and page errors were checked;
alerts/errors were zero. Overflow and native-failure screenshots were inspected. The local ignored rehearsal folder
is `performance-observability/reports/conference-rehearsal-1794695938147` and includes `rehearsal.json` with report hashes
and screenshots. Temporary servers and browser closed; original datasets were not rewritten. This is presentation
verification, not a new performance run or a fresh native app/device execution.

The current experiment suite passes 114 JS and 8 Python tests. The first sandboxed JS attempt could not bind loopback
servers; the complete suite passed with loopback access. The existing five temporary F-index negative checks still
reject invented acceptance, omitted data, erased failure, changed analysis identity and relabelled failed delivery.
Local documentation links and whitespace checks pass. No runtime/dependencies/builds/test algorithms changed.
