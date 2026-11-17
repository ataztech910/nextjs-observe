# RN Release repeat: a better tail can coexist with a worse median

17 November 2026. After merge #125 (`c442aae`), continue the [native download case](RN_NATIVE_DOWNLOAD_RESEARCH.md)
and [Hermes diagnosis](HERMES_PROFILE_RESEARCH.md). **Exploratory Simulator repeat with React profiling enabled;
not ordinary physical Release, native input/presentation acceptance or a proven causal explanation.**

## Decision

Keep both endpoints in the talk: incremental store updates reduce the observed notification latency tail while
raising typical latency in this setup. Four new ordered pairs reproduce the direction in both run orders. The
median difference also exists between JS receipt and layout effect on **one JS clock**, so it cannot be assigned
solely to cross-clock offset uncertainty. Do not turn that localization into a scheduler, CPU-frequency or GC claim.

The Hermes profiles already identify full-history aggregation outside React rendering. This repeat uses the
Release/Hermes React profiling app without an external sampler; it does not use Debug timings as benchmark evidence.
No new Observer feature is required for these measurements.

## Protocol fixed before acquisition

Four blocks: rescan→incremental, incremental→rescan, rescan→incremental, incremental→rescan. One fresh app process
per policy in each block, eight total; 8,192 history rows, 16 requested native HTTP XHR Blob bodies, 64 writes/file
every 50 ms, independent controls every 137 ms, UI refresh every 250 ms. Every callback updates the model; no
debouncing, dropping or deferred aggregation. Exact body verification follows all native loads plus the drain
opportunity; a control endpoint overlapping verification invalidates the run.

The current app sources are unchanged from the Hermes checkpoint; a separate Release artifact was built. The full
protocol was written before acquisition and copied into its folder with Results pending. Repeated measurements
are a new study, not replacements for historical values. No slow completed run was excluded or selectively retried.
Clock bounds retain the earlier conditional constant-offset model; precision/drift remain uncalibrated.

The external harness adds `research:rn-downloads -- <SIMULATOR_UUID> repeat` and
`node tools/download-latency-report.mjs reports/<session>`. It reports all per-notification intervals and four paired
process differences. Full commands and pre-acquisition protocol are in the sibling experiment repo's
`native/LATENCY_RESEARCH.md`; capture/analysis is in `tools/download-pilot.mjs`, `tools/download-latency-analysis.mjs`
and `tools/download-latency-report.mjs`. The experiment commit is recorded in the workshop journal; no remote exists.

## Results

Accepted session: `performance-observability/reports/native-latency-1794945085024/` at the workspace root.
Eight successful processes preserve 8,192 native progress callbacks, 128 loads/verified bodies and 134,340,608 bytes.
There are 567 within-process controls: one process emitted 70, the other seven emitted 71 before source completion.
They are **not 567 independent benchmark replications**. Do not pool these pairs with the historical two pairs.

All times below are milliseconds, nearest-rank descriptive quantiles within a process. Source-based values are
the lower endpoints of conditional transport/clock intervals, not exact latency, field percentiles or CPU time.

| Block/order | Policy | Source→receipt median | Receipt→layout median | Source→layout median | Source→layout p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| 0, rescan→incremental | rescan | 0.333 | 0.968 | 1.425 | 15.694 |
| 0 | incremental | 0.778 | 3.841 | 4.770 | 6.053 |
| 1, incremental→rescan | incremental | 0.707 | 4.313 | 5.156 | 6.386 |
| 1 | rescan | 0.326 | 1.001 | 1.391 | 18.573 |
| 2, rescan→incremental | rescan | 0.341 | 0.979 | 1.463 | 18.407 |
| 2 | incremental | 0.750 | 4.612 | 5.444 | 6.510 |
| 3, incremental→rescan | incremental | 0.729 | 4.369 | 5.221 | 6.510 |
| 3 | rescan | 0.361 | 1.046 | 1.814 | 18.093 |

Paired source→layout median differences (incremental minus rescan) have compatibility intervals [3.195, 3.540],
[3.590, 3.926], [3.830, 4.120], [3.264, 3.534] ms. These are conditional clock bounds, **not confidence intervals**.
Receipt→layout median differences on the JS clock are +2.873, +3.311, +3.633, +3.323 ms. Source→receipt p95 improves
in all four pairs too. Component medians/p95 do not add; the additive identity is checked per notification only.

Whole-process React render medians are 0.228–0.240 ms rescan and 0.931–1.277 ms incremental. Status/verification
renders are included; renders cannot be matched to notification layouts by ordinal index. This is a correlation,
not causal attribution. Source windows span 9.785–9.957 s; full-payload verification afterwards spans 1.912–1.975 s.
Completion context is retained separately; neither is a native startup or user-action completion measure.

The endpoint is the first layout-effect snapshot containing an ID. Its visible text could already have been replaced
by the periodic Progress label. Analysis now counts label survival separately: **567/567 retained the exact notification
label in this study**. This possible measurement issue was checked and not observed; layout still does not prove paint
or presentation. No native touch is recorded.

## Identity, exclusions and validation

| Identity | SHA-256 |
| --- | --- |
| App source manifest | `e7f0c2973c5783d12b2e164a6dee9d31700f80fa1e067bdc76802724635fa059` |
| Native executable | `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5` |
| Release bundle | `79816074ddc3ff4ec1395bedf362d151b9f8fc7a29e723261ef4582c3fa58c05` |
| Paired report | `6ad509bbb9f667c65f012e2ab8ce73a829dbe37dfe5387e55287e71d8733d3b5` |

iPhone 17 Pro Simulator, iOS 26.3.1, RN 0.88 / React 19.3 / Hermes. Folder retains the full app, source manifest,
pre-acquisition protocol, tool copies, raw per-process source/receipts, screenshots, old receipt analyses, new
decomposition outputs, paired report with eight input hashes and an evidence index. All raw evidence remains local
and ignored; this PR publishes the research checkpoint, not the capture files.

The first technical start, `native-latency-1794945004950`, was terminated and excluded because a local test suite
was accidentally launched concurrently. Its artifacts and `exclusion.json` remain retained; none enter this study.
The exclusion was recorded before paired comparison. For the accepted series, builds/tests completed beforehand;
no local test suite, build or inspector/sampler ran concurrently. OS-wide background activity and thermal/power
conditions were not controlled, so no device/general capacity claim follows.

Checks: 133 experiment tests, actual native Release build, two rejected mutations (falsely accepting an overwritten
label; subtracting the wrong clock bound), restored source and passing targeted tests. Socket-based tests initially
hit sandbox EPERM and passed with local socket permission. All eight new and eight historical Release analyses
replay identically; paired report replay is byte-identical. All 276 original presentation hashes remain unchanged.
An isolated `analysis.tgz` with the standalone report tools, model and eight raw inputs was unpacked outside both
repositories; its CLI regenerated the same report SHA without installed dependencies. This validates analysis
portability, not another app execution or a new Observer importer.
No runtime package changed; no new package publication/packed-app behavior is claimed by the documentation PR.

## Next gate

Native input must have an independent timestamp and declared completion endpoint; ordinary physical Release
performance stays separate from profiling diagnostics. Investigate scheduling/CPU/GC with a declared intervention
before naming the cause. Then complete React Components Profiler, startup, SSR hydration, Flashlight and executable
CI regression workflow against the unchanged conference brief. This case is stronger research evidence, not full
conference acceptance or a reason to remove promised topics.

Observe/app adapters keep instrumentation, the external harness owns experiments, the OTLP backend ingests/stores,
and Observer frontend displays supported report schemas. This paired JSON remains a research format, not a new
Observer import contract. No instrumentation is moved into Observer.
