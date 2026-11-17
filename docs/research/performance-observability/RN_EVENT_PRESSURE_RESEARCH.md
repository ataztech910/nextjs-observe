# RN research: small renders, delayed notifications

17 November 2026. **Retain as a candidate; not conference or physical-device acceptance.** This research follows
the fixed talk description: find a useful profiler/endpoint mismatch, rather than another artificial blocking loop.
The published title and abstract remain unchanged. The original presentation remains at `workshop-slides/`.

## Finding

A controlled transfer-history store can delay a notification while React render durations remain small.
Under 8,192 rows / 320 progress messages per second, two rescan runs had maximum React render below 0.710 ms,
but source-send → JS receipt lower endpoints reached 33.180 ms. Replacing whole-history recomputation with an
incremental update preserved all events/final rows and reduced that observed range to 0.229–0.597 ms.
The incremental runs' render maximum was higher (1.383 ms), demonstrating why render duration alone would
rank these variants poorly for notification responsiveness. React profiling is measuring its own endpoint correctly.

The initial notification schedule aligned with source bursts. A separately retained phase follow-up still found
rescan delay up to 36.857 ms to receipt and 41.477 ms to first containing layout effect; incremental layout-effect
lower endpoints were 2.271–4.795 ms. Do not call layout effect paint or infer native frame drops.

This is a model of callbacks plus repeated derived-state work, **not actual downloads, production SDK behavior,
a customer incident or measured touch input**. The small-load and fast-notification observations below are equally
part of the result. No general speedup, unacceptable-performance threshold or physical-device claim is accepted.

## Protocol and mechanism

The existing RN 0.88 / React 19.3 Release/Hermes host runs a separate `event_pressure` scene. An external loopback
WebSocket server sends a fixed three-second stream of simulated progress updates. Unlike a JS interval inside RN,
the source continues independently of the overloaded consumer. Four or sixteen messages are sent per 50-ms burst,
for rates of 80 or 320 messages/s. Sixteen active items update inside a completed transfer history.

- `rescan`: map the full collection on every callback, then filter/reduce all four group summaries.
- `incremental`: update a private row index and the affected group's byte total by its delta.
- Both request display refresh every 250 ms and immediate display update for each control notification.
- No repeated dummy checksum loop, event dropping, debounce or deferring required work beyond completion.
  Final rows and summaries match the independent expected stream. Sequence/count/digest are checked at runtime;
  unit tests compare exact summaries after every event prefix.

App-side React `Profiler` wraps the whole scene, not merely a chosen fast leaf. An **opt-in diagnostic artifact**
selects the installed ReactFabric profiling implementation through Metro; default builds keep their existing renderer.
Actual callbacks are required—missing production Profiler data is unavailable, never zero render time. This is
Profiler API acquisition, **not a captured React DevTools UI workflow**, and no Hermes CPU sampling recording was
made in these runs. Those fixed-brief deliverables remain open.

Seven clock ping pairs before and seven after retain compatible constant server-minus-JS offset bounds. Source
send → receipt includes loopback transport, native networking/dispatch and JS waiting; it does not isolate queue
CPU or one native layer. Precision/drift are uncalibrated. Transport half-width does not establish full accuracy.
Per-message service windows measure parse/model work and bookkeeping up to their finish timestamps, not whole
JS tasks. Their maxima in the high-load rescan conditions were below 4.904 ms; this does not prove that no longer
JS task, GC pause or native stall occurred.

## All sweep conditions

Each row represents **two fresh process runs and six control notifications**, not hundreds of independent samples.
Conditions are visited in fixed order; variant order reverses in block two. No warmups, CI interval, performance
budget or confirmatory sample size is claimed. Do not pool within-run events as benchmark replications.

Delay ranges below summarize the **lower endpoints** of the retained transport-bound intervals. They are not
confidence intervals or exact calibrated timings. Maximum transport half-width in the main sweep was <0.113 ms.

| History rows | Messages/s | Policy | Send → receipt lower endpoints, ms | Send → layout lower endpoints, ms | Max render, ms |
| --- | --- | --- | --- | --- | --- |
| 2,048 | 80 | rescan | 0.297–4.682 | 1.759–7.271 | 0.799 |
| 2,048 | 80 | incremental | 0.254–0.873 | 1.289–4.123 | 1.299 |
| 8,192 | 80 | rescan | 0.294–13.775 | 1.399–15.293 | 0.682 |
| 8,192 | 80 | incremental | 0.184–1.917 | 1.088–4.365 | 4.696 |
| 2,048 | 320 | rescan | 0.221–9.541 | 1.633–10.801 | 0.811 |
| 2,048 | 320 | incremental | 0.193–0.786 | 1.421–4.594 | 1.416 |
| 8,192 | 320 | rescan | 0.138–33.180 | 1.155–34.108 | 0.709 |
| 8,192 | 320 | incremental | 0.229–0.597 | 2.046–4.368 | 1.383 |

Main-sweep notifications at 250/1250/2250 ms align to the 50-ms burst period. A separate phase protocol uses
255/1270/2285 ms at 8,192 rows / 320 messages/s, again two process runs per policy and reversed order:

| Policy | Send → receipt lower endpoints, ms | Send → layout lower endpoints, ms | Max render, ms |
| --- | --- | --- | --- |
| rescan | 0.232–36.857 | 1.546–41.477 | 0.689 |
| incremental | 0.293–0.671 | 2.271–4.795 | 1.198 |

Keep this phase sensitivity visible. An individual notification may miss the stall; one entered JS quickly but
waited much longer for its layout effect. Selecting only the worst observation would overstate the result.

## Provenance and verification

Implementation lives in the separate local experiment repository, branch `research-rn-progress-pressure`, commit
`9980d23`; that repository has no remote. [Full local protocol and commands](../../../../performance-observability/native/PROGRESS_RESEARCH.md).
No runtime changes or raw reports are bundled into this monorepo documentation commit.

| Session | Role | Completed runs |
| --- | --- | --- |
| `progress-pilot-1794940114565` | Initial working smoke | 2 |
| `progress-pilot-1794940142670` | Four-condition sweep, both orders | 16 |
| `progress-pilot-1794940244700` | Phase follow-up, both orders | 4 |

Ignored `performance-observability/reports/<session>/` directories retain the protocol written before acquisition,
raw source/client records, source manifest, copied harness/model/host source, per-run analyses, screenshots,
summary and a copy of the actual `.app`. All 22 completed runs preserved expected event count/sequence and full
final rows. Earlier failed harness attempts (`1794940005026` WebSocket server API; `1794940025129` RN URL hostname
parser) remain separate and are excluded from performance evidence.

Simulator UUID `84FECE7E-DB76-474C-B6CF-E2229FD32F93`, iPhone 17 Pro type, iOS 26.3.1. Pinned identity:

- Source SHA: `737788dc12889d1306b53a3be6faba284cc78e9392a23c006f5b99c5dd86b9d0`.
- Native executable SHA: `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`.
- Embedded bundle SHA: `296797cb80da26c5810cc16e0fe9c9d987b8d7b31c586d6dc5ed67d01bbd996d`.

Experiment checks: 119 tests pass, including five new equivalence/measurement-validation tests; web typecheck/build
pass; native Release compile/link and all 22 actual Simulator runs pass. Two intentional mutations were rejected:
count cumulative progress as a fresh delta; fabricate zero render cost when profiling data is absent. Restored source
passes targeted tests. The first sandboxed full-suite attempt could not bind existing HTTP test ports; the full suite
passed with local networking available. Original presentation inventory: all 276 recorded hashes unchanged.
The commit hook reported AI review unavailable/timeout and automatically continued; no hook was bypassed.

## Next research gates

1. Replace the model with real native progress/notification acquisition or a shareable app workload. Validate
   history/rate/burst realism before using this as the main conference case. Keep the complete small-load results.
2. Record Hermes CPU samples and an actual React DevTools workflow to locate the expensive callback/store path.
   Current app-side service timings establish the selected window only.
3. Add independently timestamped native input and a declared completion endpoint, then ordinary physical Release
   comparisons separate from diagnostic profiling. Do not relabel source notifications as touches or presentation.
4. Freeze a confirmatory protocol with warmups, phase variation, ordering/repetitions, invalidation and a decision
   rule. This exploratory effect is useful for choosing that protocol, not a finished CI performance budget.
5. Connect accepted signals to app-owned custom instrumentation and existing reporting. Observe/app collects;
   external harness compares; OTLP receiver/storage owns ingestion; Observer frontend reads. No instrumentation
   was moved into Observer. This pilot's raw JSON is not a newly supported Observer report schema.

Startup, hydration, Flashlight and the CI regression workflow remain independent requirements of the fixed brief.

Tool scope references: [React Profiler](https://react.dev/reference/react/Profiler) defines render duration and
production-profiling caveats; [RN performance](https://reactnative.dev/docs/performance) distinguishes JS touch
processing from native/UI work; [RN DevTools](https://reactnative.dev/docs/react-native-devtools) distinguishes its
React/debugging views from native tooling. These describe tool boundaries, not the measured results above.
