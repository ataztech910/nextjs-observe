# Conference slides — editorial draft

Preferred visual version: [copied workshop graph engine](../../../presentations/profiler-to-production/graph/README.md), on its own port 4349. The original `workshop-slides` is unchanged; the flat deck below remains the print fallback.

Visual companion (15 November): [standalone presentation](../../../presentations/profiler-to-production/index.html) and [editing/preview instructions](../../../presentations/profiler-to-production/README.md). The sections below remain the editorial source; the visual deck is built separately from them.

Draft after merge #116 (`d94c9b8`), 14 November 2026. English slide copy and speaker notes for
**From Profiler to Production: Measuring What Actually Matters in React & React Native**.
The confirmed total slot is 30 minutes. The [run of show](CONFERENCE_RUN_OF_SHOW.md) allocates 25 minutes to
slides 01–08 and 5 minutes to Q&A, including transitions and saved-report visits. A1/A2 are question-support
appendices, with no extra slot. These are rehearsal targets; actual spoken timing remains unmeasured.
Each numbered section is one slide. Only **On screen** content belongs on the audience slide; keep the
source/session/endpoint and boundary visible with the result.
**Speaker notes** and **Evidence cue** are presenter material. Figures below are retained observations, not new runs.

---

## 01 — From Profiler to Production

**On screen**

From Profiler to Production

Measuring What Actually Matters in React & React Native

Start with the interaction. Name the endpoint. Preserve the evidence.

**Speaker notes**

Timing: 00:00–01:30 elapsed; budget 1:30. State the question and scoped local evidence; move to the endpoint model at 01:30.

“When we say an app is fast, which observation do we mean: load, selected JavaScript work, React completion,
or pixels presented? I will show controlled cases where these observations answer different questions.
These are reproducible local experiments, with explicit limits. They do not prove a universal production result.”

**Evidence cue**

[Scope and six-experiment coverage](CONFERENCE_DEMO_PLAN.md). The original hypothesis remains a question;
this draft makes only the selected scoped claims. No numerical performance claim on this title slide.

---

## 02 — Name the boundary before reading the number

**On screen**

User action → handler → selected JS work → React completion → visible result

| Observation | Boundary |
| --- | --- |
| Selected work | Explicit synchronous callback body |
| React completion | Handler start → Profiler callback |
| Readiness | Navigation start → declared app marker |
| Presentation | Requires a browser/native presentation source |

React completion and readiness leave presentation unmeasured in these app markers.

**Speaker notes**

Timing: 01:30–04:30 elapsed; budget 3:00. Finish endpoint definitions by 04:30; the arrow is conceptual, not a measured critical path.

“This arrow is a conceptual sequence, not a measured critical path. Intervals can overlap, work can repeat,
and asynchronous or concurrent operations need explicit context. Our Profiler endpoint records an app-defined
completion observation; it does not reveal when pixels became visible. We retain missing observations as missing.
We also keep wall duration, sampled CPU evidence and independently acquired process CPU separate.”

**Evidence cue**

[Interaction/timeline model](PERFORMANCE_TIMELINE.md), [selected hook strategy](REACT_HOOK_INSTRUMENTATION.md),
[A endpoint](EXPERIMENT_A_GATE.md), [B endpoints](EXPERIMENT_B_GATE.md).

---

## 03 — A: the same load score, different later interaction

**On screen**

Eight Lighthouse navigation reports: **100 / 100**.

Four matched primary blocks: degraded-minus-baseline handler-to-Profiler run-median gaps

**214.2 · 200.8 · 213.3 · 213.6 ms**

The selected expensive work was deliberately deferred beyond navigation.

Source: `load-a-1794560947170-6c40`

Endpoint: handler start → React Profiler callback.

Boundary: one local unthrottled Mac; four primary matched blocks; descriptive result.

**Speaker notes**

Timing: 04:30–08:30 elapsed; budget 4:00. Use at most 60 seconds for the saved report; skip diagnostics if late. Finish A at 08:30.

“Here the navigation score stays at 100 in all eight load reports. Then the user performs the nominated
interaction. Every matched block shows a larger handler-to-Profiler median with the deferred expensive work.
Lighthouse is measuring its declared load protocol; our later interaction is a different endpoint.
The four numbers are block-level differences. The individual clicks are not independent run replications.”

“Lifecycle INP is recorded separately on the three-click lab pages. It is not a renamed handler duration or a
field Core Web Vital. The profiled source diagnostics are separate runs, excluded from these primary timings.”

**Evidence cue**

[A protocol, full values and limitations](EXPERIMENT_A_GATE.md).
Select `?report=load-a-1794560947170-6c40` on its session viewer. Show both variants and all primary blocks;
use the separate lifecycle/source attachment if asked. If the viewer is unavailable, use the retained original
report screenshot or analysis with this session/endpoint visible; do not collect a new timing during the talk.

---

## 04 — B: identical downloaded code, different configured work

**On screen**

Same JS artifact and matching downloaded bodies. Different startup configuration.

| Endpoint | Baseline | Degraded |
| --- | --- | --- |
| Selected compute | 1.4–3.2 ms | 348.7–354.3 ms |
| Navigation → first layout effect | 82.2–146.3 ms | 424.4–448.1 ms |

Source: `bundle-b-1794566743221-443a`

Boundary: four primary matched pairs on one Mac; ranges are observed run values, not confidence intervals.

**Speaker notes**

Timing: 08:30–12:30 elapsed; budget 4:00. Use at most 60 seconds for saved byte evidence; finish B at 12:30.

“The same compiled code is configured to do different amounts of redundant startup work, with the same result.
The preserved response bodies and browser/cache receipts establish byte comparability. This is a controlled
same-artifact example; it does not compare the parse cost of two different equal-size bundles.”

“The selected compute interval excludes imports, SDK and capture setup. Navigation-to-first-layout-effect
includes earlier loading and setup. Neither number is whole-bundle CPU or paint. Gzip was actually served;
Brotli sizes are saved artifacts. Browser transferSize is not exact socket traffic. Diagnostic source profiles
are excluded from the four primary timing pairs.”

**Evidence cue**

[B exact protocol and byte joins](EXPERIMENT_B_GATE.md).
Select `?report=bundle-b-1794566743221-443a`; show byte evidence beside the distinct timing endpoints.
Diagnostic readiness remains unavailable rather than entering the primary comparison.

---

## 05 — Instrumentation and analysis have different jobs

**On screen**

Observe / app → OpenTelemetry SDK → OTLP → collector / archive → Observer

External Playwright / Maestro harness → preserved observations and analysis → typed report → Observer

| Layer | Responsibility |
| --- | --- |
| Observe and app adapters | Selected instrumentation and source context |
| External harness | Protocol, independent sources, statistics and artifacts |
| Backend collector/archive | OTLP ingestion, storage, finalization and replay |
| Observer frontend | Display reports, telemetry and explicit unavailable states |

**Speaker notes**

Timing: 12:30–15:30 elapsed; budget 3:00. Use the four responsibility rows. Omit the optional C walkthrough if late. Finish at 15:30.

“OpenTelemetry is the interoperability boundary. The backend collector lives in the next-observer package,
while its ingestion and storage responsibilities are separate from the frontend. We do not move app
instrumentation or experiment statistics into the visualization.”

“Manual selected hook work carries a source site and explicit interaction context. This is not complete automatic
hook discovery. Our supporting C Playwright report is a single baseline functional smoke with three actions;
it verifies association and the pipeline, not an optimization effect or statistical performance acceptance.”

**Evidence cue**

[Actual implementation files and responsibilities](F_EVIDENCE_MATRIX.md#responsibilities-and-current-implementation),
[Observe manual strategy](REACT_HOOK_INSTRUMENTATION.md), [scenario reader](SCENARIO_REPORTS.md).
Optional C report: `web-scenario-1794566774159-a535ac`. The two arrows describe data flow, not shared clock alignment.

---

## 06 — F delivery: a completed check can contain incomplete telemetry

**On screen**

| Trace case | Delivery state |
| --- | --- |
| Healthy export | passed |
| Deliberate queue overflow: 20 dropped spans | incomplete |
| HTTP400 rejection | failed |

Source: `pipeline-1794641370737-5d72`

Endpoint: produced spans → SDK queue → exporter → receiver.

Boundary: controlled faults; no production loss-rate claim.

**Speaker notes**

Timing: 15:30–19:30 elapsed; budget 4:00. Use at most 60 seconds for the trace report; reserve metric retry details for questions. Finish at 19:30.

“The fault-validation check succeeds when it accurately preserves the fault. It cannot promote delivery to passed.
The overflow archive remains unfinalized and the rejected export remains failed. A received-only archive tells us
what arrived; producer IDs, SDK counts and exporter evidence tell us what is missing.”

“Metric retry, rejection and held-callback cases add another distinction: a reader flush can resolve while export
errors still exist. Keep callbacks, HTTP attempts and received records separate. Cumulative histogram checkpoints
are separate snapshots; adding them counts earlier observations again.”

**Evidence cue**

[Trace gate](F_PIPELINE_GATE.md), optional [metric gate](F_METRIC_DELIVERY_GATE.md).
On the source shelf select `?report=pipeline-1794641370737-5d72` and scroll to overflow and HTTP400, not just healthy.
The report also contains a disabled-control row; the three rows above are a selected case view, not its full inventory.
Optional metric report: `metric-1794646414485-258d`. Retain failed/incomplete labels in any screenshot crop.

---

## 07 — F cost: keep bytes, readiness and CPU separate

**On screen**

| Loaded gzip JavaScript | Bytes |
| --- | --- |
| Stripped | 1871 B |
| Observe installed, runtime disabled | 8275 B |

Installed-minus-stripped navigation → adapter-ready:

**+21.433 ms [1.450, 44.650]**, exploratory 95% paired interval.

Work-CPU interval spans zero.

Source: `stripped-1794680848671-8f54`

Boundary: two build artifacts, six local alternating run pairs; no accepted overhead budget.

**Speaker notes**

Timing: 19:30–23:00 elapsed; budget 3:30. Keep byte/readiness/CPU boundaries; defer statistical-method details. Start the closing slide at 23:00.

“Both groups are disabled. One build removes Observe and OTel; the other retains the installed adapter and lazy SDK
graph. Source maps and the actual loaded response bodies verify the difference. These are loaded gzip body bytes,
not emitted totals, installation footprint or total wire traffic.”

“Adapter-ready happens before variable metadata/archive setup. The wall difference combines loading, evaluation
and setup effects of these two builds. The original interval is exploratory, using paired-run bootstrap assumptions.
Six run pairs are not six independent builds. The work-CPU interval includes zero: we cannot conclude equivalence,
a speedup or acceptable overhead. Startup wall does not measure startup CPU. All contrasts remain in the attachment.”

**Evidence cue**

[Stripped protocol and all original contrasts](F_STRIPPED_STUDY.md).
On the paced/monitor/build shelf select `?report=stripped-1794680848671-8f54`.
Keep loaded/emitted and work/finish windows separate. Do not subtract results from another F study.

---

## 08 — Make the performance statement inspectable

**On screen**

For every result, carry:

- Endpoint and measurement source.
- Workload, build and environment.
- Independent run count and uncertainty.
- Delivery, missing data and source artifacts.

Next step: choose the target claim, then measure its missing endpoint.

**Speaker notes**

Timing: 23:00–25:00 elapsed; budget 2:00. Close at 25:00 and leave 5 minutes for Q&A. Stay here; do not automatically advance to A1.

“The examples show why the metric name alone is insufficient. We can already show these bounded comparisons in
Observer. A product overhead guarantee would need a workload, target devices/builds, validated cost sources,
a budget and a declared decision rule. Those are still open. We have ten different scoped F protocols, not a
single pooled benchmark. Their row counts are inventory, not acceptance percentages.”

“For native performance, the next missing observation is independently supported presentation on a physical
Release target. We should state that gap explicitly rather than infer frame smoothness from JS or callback data.”

**Evidence cue**

[Full coverage, boundaries and closure order](F_EVIDENCE_MATRIX.md),
[pinned index](F_EVIDENCE_INDEX.json), [demo fallback/rehearsal](CONFERENCE_DEMO_PLAN.md).
Close here for the short version. The native and runner slides below are optional appendices, within the five-minute Q&A allocation. No claim that all A–F or production performance acceptance is complete.

---

## A1 — React Native: callback cadence is one observable

**On screen**

Release / Hermes on iOS Simulator:

Native callback acquisition continued during selected blocked JS work.

Native presentation / hitches: **unavailable in the retained Simulator hitch probe**.

Source: `ios-cadence-1794441662289`; diagnostic corroboration `ios-system-1794455821579`.

Boundary: Simulator functional evidence; no physical smoothness or dropped-frame conclusion.

**Speaker notes**

Timing: Q&A only (25:00–30:00); no extra slot. Open only for a relevant native question; preserve unavailable presentation and stop by 30:00.

“The app-local CADisplayLink buffer acquires without calling JS per callback. Raw native timestamps and pre/post
clock pairs are retained. The constant-offset model permits a conditional count inside the selected JS bracket;
transport half-width is not a complete precision or drift bound.”

“The system recording matches callback signposts and includes separate JS/Hermes CPU sampling. The signposts share
the callback source; they are not an independent compositor sensor. Animation Hitches was unsupported on this
Simulator. Its count and ratio stay unavailable. A real native-jank or smooth-FPS claim still needs supported
physical Release evidence, source validation and the declared repeated comparison.”

**Evidence cue**

[Native source and clocks](IOS_NATIVE_CADENCE.md), [original unsupported hitch probe/system artifacts](IOS_SYSTEM_PROFILER_GATE.md).
Use the retained standalone system analysis if available. Do not turn callback spacing into presented-frame FPS.
D is a functional appendix here; E native-jank acceptance remains open.

---

## A2 — Runner outcome and archive state are separate

**On screen**

| Maestro scenario | Scenario outcome | Telemetry archive |
| --- | --- | --- |
| Original completion assertion | passed | finalized |
| Deliberately wrong completion assertion | failed | finalized |

Sources: `maestro-1794559097407-1a14dc`, `maestro-1794559119640-609fd2`.

Endpoint: JS scheduling and native callback proxy; presentation unavailable.

**Speaker notes**

Timing: Q&A only (25:00–30:00); no extra slot. Open only for a relevant runner/archive question; keep the answer inside the remaining Q&A time.

“Maestro actually triggers the app and checks completion. The negative scenario intentionally fails its UI assertion,
while the app's telemetry can still be completely archived. Finalization does not make the runner pass.
The harness preserves both results with original JUnit, command evidence, app receipts and raw OTLP.
Runner action time is not app CPU, touch latency or a frame metric. This is Simulator integration evidence,
not a repeated native performance result.”

**Evidence cue**

[Maestro contract and negative flow](MAESTRO_GATE.md). Open the two reports separately using the demo-plan recipe;
show the failed scenario with its finalized archive in the same screen. If appendix time is unavailable, keep this
as a question-and-answer example rather than displacing a core comparison.

---

## Editorial handoff

The [demo plan](CONFERENCE_DEMO_PLAN.md) owns viewer startup, exact report IDs, rehearsal and fallback instructions.
The [F evidence matrix](F_EVIDENCE_MATRIX.md) owns current F claim coverage; the method docs own statistical details.
This draft adds neither a new protocol nor new measurements. The total slot is 30 minutes; the separate visual deck is available. Next editorial step: rehearse the
25-minute main route and five-minute Q&A allocation before freezing audience-visible slides. Retain source/session/endpoint/boundary text in the eventual rendering.

Original screenshots and raw reports remain ignored local artifacts in the sibling experiment repository with no
remote. This Markdown alone is not a portable offline evidence bundle. Use the saved original screenshot/analysis
when available; otherwise omit the numerical result according to the demo fallback. No embedded screenshot or
new browser rendering is claimed by this content draft.
