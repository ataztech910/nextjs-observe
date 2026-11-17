# RN native input: validate the touch path separately from notifications

17 November 2026. After merge #126 (`20b2c9c`), extend the [notification repeat](RN_LATENCY_DECOMPOSITION.md)
with an actual native touch source. **Simulator functional measurement gate, not a touch p95 benchmark, ordinary
physical Release acceptance or input-to-photon measurement.** Fixed conference title/abstract remain unchanged.

## What the gate measures

Maestro presses a start control, then taps a separate response control three times during real native XHR downloads.
The app immediately copies native timestamp/identifier from `onTouchStart`, `onTouchEnd` and `onPress`.
Completion is the JS layout effect for `Input acknowledged N`. The receipt retains native down/up, JS receipt and
acknowledgement timestamps separately; no server message or JS timer generates the measured input.

In the installed RN 0.88 Fabric path, `RCTSurfaceTouchHandler.mm` reads `UITouch.timestamp`; `RCTConversions.h`
maps seconds to the shared high-resolution clock, and `BaseTouch.cpp` puts milliseconds in the native event payload.
Apple defines [UITouch.timestamp](https://developer.apple.com/documentation/uikit/uitouch/timestamp) as uptime at
touch occurrence/change. These installed source files, timing primitives and runtime clock binding are retained
with hashes. No new native instrumentation module or instrumentation inside Observer is needed.

Seven `PerformanceCadence.ping` pairs before and seven after bound the native-minus-JS offset under a constant-offset
model. The report keeps native down→up contact duration, touch-up→JS onPress and touch-up→ack layout compatibility
intervals, plus same-JS-clock onPress→layout. Transport bounds do not calibrate timestamp accuracy, precision, drift
or Simulator injection. Maestro command duration is never used as touch latency.

## Protocol and validation

The initial v1 protocol below completed one series. The final v2 revision is described separately; do not pool them.

Two ordered blocks, rescan→incremental and incremental→rescan; four fresh Release/Hermes React profiling processes.
Each keeps 8,192 history rows, 16 requested native XHR Blob bodies, 64 writes/file every 50 ms, independent controls
every 137 ms and UI refresh every 250 ms. Three sequential Maestro gestures per process. Initial readiness and
calibration happen before acquisition; all native bodies and final store state must validate.

Require exactly three down/up/press/ack associations, compatible native clock anchors, no cancellation/backgrounding,
timestamps/acks inside acquisition before body verification, and native callbacks before and after each onPress.
Do not assume the JS onTouchEnd callback precedes onPress: the captured order can be the reverse. Match the native
event timestamp/identifier instead. Immediate copying avoids retaining mutable React event objects.

The external harness adds `research:rn-downloads -- <SIMULATOR_UUID> input`, with explicit `JAVA_HOME` / `MAESTRO_BIN`
from the existing Maestro setup. `node tools/input-report.mjs reports/<session>` replays app/body checks and verifies
runner exit, exact run/flow JUnit identity, three ordered taps and acknowledgement assertions. Cancellation/deadline
or missing/failed/optional command evidence cannot produce a passing report. Individual points are reported;
no p95, population distribution or overhead budget is inferred from twelve taps.

The initial session `native-input-1794947484145` completed all four processes and twelve touches. A footer-only
rebuild corrected the inherited notification-only wording. Its next v1 session, `native-input-1794953358672`, failed
on the first process when the third Maestro touch arrived after acquisition. This is retained as a **failed gate**,
not silently retried or stripped of a slow point. Its partial native events/source and failure reason remain local.
Early app failure also exposed a cleanup race: the harness now awaits runner cancellation/log persistence before
exiting. A dedicated test requires persistence to finish when app failure wins.

Before acquiring v2, the protocol was revised to **128 writes/body at the same 50-ms cadence**, with unchanged
body bytes, history, variants, three taps/process and two balanced blocks. This extends acquisition for sequential
Maestro actions without reducing write cadence. It changes total callback work, so it is a different functional
protocol, not a performance comparison with v1. Callback delivery can coalesce writes; use observed populations.
The timestamp/UI implementation is unchanged from the footer-corrected build.

App/Observe adapters own collection; the external harness owns Maestro/orchestration/analysis; the actual backend
owns OTLP ingestion/storage, and Observer frontend reads supported schemas. This research JSON is not a new
Observer import contract. No collector or Observer runtime package changes in this checkpoint.


## Retained results and limits

Follow-up: [paced input with a no-download control](RN_PACED_INPUT_RESEARCH.md) retains nine processes and 27 gestures.
The phase-coverage gate fails with four misses; it does not close phase-controlled benchmark acceptance or replace
the initial functional evidence below.

Final v2 session: `native-input-1794953533485`, four fresh processes / twelve gestures, all associated Maestro
JUnit/ordered commands and app/body checks passed. Every run delivered 2,048 native progress callbacks and sixteen
loads: 8,192 progress callbacks, 64 verified bodies, 67,170,304 bytes total. All callbacks update the same final model.

Individual observations in tap order, milliseconds. Native-based values are **lower endpoints** of conditional clock
compatibility intervals, not exact latency, calibrated uncertainty, confidence bounds or percentiles. Native down→up
contact was about 116.667 ms and is retained separately; it is not part of the touch-up endpoint below.

| Block | Policy | Touch up→JS onPress, 3 points | JS onPress→ack layout, 3 points | Touch up→ack layout, 3 points |
| --- | --- | --- | --- | --- |
| 0 | rescan | 24.459 / 15.260 / 8.595 | 0.863 / 0.989 / 1.042 | 25.322 / 16.249 / 9.637 |
| 0 | incremental | 19.188 / 7.424 / 8.730 | 1.691 / 1.454 / 1.458 | 20.879 / 8.878 / 10.188 |
| 1 | incremental | 16.740 / 6.081 / 15.749 | 1.461 / 0.862 / 1.258 | 18.201 / 6.943 / 17.007 |
| 1 | rescan | 19.443 / 11.462 / 7.714 | 0.962 / 0.956 / 0.995 | 20.405 / 12.419 / 8.709 |

Native ping interval widths are 0.014–0.023 ms; this is transport compatibility only, not touch timestamp accuracy.
Sample positions differ: between 204 and 1,356 native callbacks had been handled at onPress. Sequential Maestro
waits for each acknowledgement, so input phases are not independently scheduled or workload-phase matched.

The initial valid v1 session `native-input-1794947484145` retains four processes / twelve gestures separately,
with touch-up→layout lower endpoints spanning 8.367–21.217 ms. It received 4,094 progress callbacks for 4,096 source
writes, with all 64 bodies intact; callback/write counts need not match. Its original report/source snapshots remain
unchanged. The later failed v1 session remains failed; its partial input/source evidence is retained, while the
cleanup race meant runner evidence could be incomplete. The cleanup fix is tested explicitly; no missing JUnit is
reported as passed. Neither v1 series is pooled into v2 or silently replaced because of its timing values.

**Decision:** the native input measurement path now works. These sparse observations do not establish an input
optimization win. Both policies' observed ranges overlap, there is no idle input control, and scheduling/CPU/GC
causes have not been isolated. The earlier notification p95 improvement must not be presented as a proven native
input/UX improvement. A small render duration omits the event path before the JS handler, but these intervals do
not isolate JS queue time, CPU time, native presentation or physical hardware latency.

## Final artifact identity and checks

- App source SHA: `b0664684e452165c8ace49ef461fdd2fe1e89770185c9c9739e18310774ed8ea`.
- Native executable SHA: `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`.
- Release bundle SHA: `cf06565139a9746948c43fbb6e0ff8828b070cd8918e2cecbe394258392a0733`.
- `input-study.json` SHA: `e9d3bc972a7c3af9d44cdc60171d298be66f5fb24262924ce36580c9c0727194`.

Local evidence lives under `performance-observability/reports/<session>/` at the workspace root and stays ignored;
the experiment repository has no remote. Final folder retains the whole app and file hashes, source manifest plus
matching prepared source bodies, installed RN clock/touch source files and hashes, raw native inputs/clock pairs,
XHR receipts/source, concrete Maestro flows, runner logs/exit/JUnit/commands, per-flow screenshots and report input
hashes. The source-path files describe the installed RN implementation, not a separately proven rebuild of every
prebuilt RN library. Use Maestro's `takeScreenshot/native-input-completed.png` for UI evidence: root post-run
screenshots can show SpringBoard after runner teardown and do not prove the app acknowledgement.

Checks: 138 JS tests and 3 Python tests; actual final native Release build; earlier production Metro/Hermes compilation;
mutations of timestamp units and active-window rejection fail, restored source passes. The runner tests cover early
app failure, abort, deadline, wrong JUnit flow and persisted cancellation evidence. Both input series and all sixteen
previous Release notification analyses replay identically. An isolated packed analysis CLI (Node + Python stdlib,
no installed npm dependencies) regenerates the exact report SHA; mutating its JUnit flow name fails, then restoration
passes. Artifact: `/private/tmp/native-input-export-8uiz6_sp/analysis.tgz`. The original presentation's 276 hashes are
unchanged. No builds/tests/sampler ran concurrently with acquisition; OS-wide power/background conditions remain
uncontrolled. Simulator was returned to the manual Release screen.

Next: declare a repeated input protocol with **idle control and independent tap phases**, then a causal intervention
before attributing delays to scheduling/CPU/GC. Ordinary physical Release/presentation, React Components Profiler,
startup, SSR hydration, Flashlight and an executable CI regression rule remain open requirements of the fixed brief.
No old presentation is changed and no raw-input schema is added to Observer.
