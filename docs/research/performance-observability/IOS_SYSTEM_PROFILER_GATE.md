# iOS system profiler gate — 12 November 2026

An actual Animation Hitches recording on the dedicated iOS 26.3.1 Simulator / Xcode 26.3 exits 2 with
`Hitches is not supported on this platform`, saving its original trace/log. Hitch count and ratio remain unavailable,
not zero. Local XCTest headers expose XCTHitchMetric, but XCTest was not run and API presence does not establish
runtime capability. Physical hitch/presentation acceptance remains open. See [Apple's hitch model](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app).

The completed, available path is Time Profiler + Points of Interest on two fresh diagnostic app launches. This follows
[native cadence PR #99](https://github.com/ataztech910/nextjs-observe/pull/99). App-owned opt-in signposts mark
CadenceWindow, NativeCallback and JSWorkBoundary with run ID and callback index/native time. Raw native buffer records
are matched one-to-one with the system-recorded signposts. These share the same callback source and validate external
recording correspondence; they are not a second independent compositor sensor. Time Profiler CPU sampling is a separate
system source used to identify running JS/Hermes work in the recorded interval.

The native bridge bracket includes handoff/queue overhead and is not the exact selected-body span or pure CPU time.
The report axis uses original trace nanoseconds, not invented JS/native epoch alignment. Normal app launches leave
system tracing off; diagnostic profiling runs are excluded from performance/overhead claims.

## Retained evidence

Session `reports/ios-system-1794455821579`, separate experiment repo:

| Diagnostic observation | Idle | JS blocked |
|---|---|---|
| Native callbacks, all matched in system signposts | 51 | 85 |
| Callbacks inside native bridge bracket | 0 | 35 |
| Running JS/Hermes CPU samples inside bracket | 1 | 588 |
| Native bridge bracket duration | 0.409 ms | 589.490 ms |

One profiled recording per condition; these are functional observations, not distributions, utilization, a confidence
estimate or overhead comparison. The unsupported hitch probe is retained with the same session. Original .trace,
TOC, machine-valued signpost/symbolicated CPU XML, native/OTLP receipts, source artifact body, native .app/dSYM,
build/backend identities, analysis JSON/HTML and screenshot are preserved locally.

Source SHA `d1741c309ff7b3ebbd2ec01795a11bef529fceedf29ae3bac0ed3c4285ac9818`, embedded bundle SHA
`6a0f867972bb98123692eb4ade836c88f8ee523b82524b1c297d23752bcb6c84`. Re-analysis is byte-identical; analysis SHA
`bd19dd0f7eff713b39e2757dfe31ff958a58896ea0e78d31cb1c9fa1adfd6e75`.

From the experiment repo after the Release build and loopback collector startup:

```sh
node tools/ios-system-trace.mjs <BOOTED_SIMULATOR_UUID>
python3 tools/system_trace.py reports/<PRINTED_SESSION>
```

The temporary receipt receiver closes after recording. Parser validates typed XML/reference IDs rather than localized
fmt strings, process/run/source identity, paired intervals, contiguous callback indexes and original native times.
Foreign/absent CPU data, partial captures and missing/corrupt callbacks are rejected. Hitch count/ratio stay null.
A standalone timeline shows actual callback events and JS/Hermes samples with the native bracket explicitly labelled.

34 JS tests and 6 Python tests pass; three parser mutations catch unsupported-to-zero, ignored callback population and
foreign-run acceptance. Web typecheck/build and native Release compile/link pass. A new asynchronous marker-failure
test verifies rejection/cleanup without success. Non-profiled cadence (six conditions + native lifecycle self-check)
and bootstrap (three modes) regressions pass on the same artifact, systemTracing=false / profiler label=off.
Browser checked the standalone timeline and its unsupported state; page errors=0. Original web sessions unchanged.
Packed collector/UI remain separate and unchanged; installed dependency symlinks are reused, not a clean install.

Next gate: supported physical-device setup/signing and independently measured Instruments/XCTest hitches/presentation,
with original system artifacts. This step changed no phone settings/accounts. T7 and D/E/F acceptance remain open;
Simulator success in Time Profiler does not close the unavailable Animation Hitches measurement.
