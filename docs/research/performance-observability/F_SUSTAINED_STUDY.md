# F bounded paced workload with periodic export

After monorepo merge #111 (`08a7676`), the sibling experiment at local commit `1a7e54d` adds
`/sustained.html`. Monorepo branch: `step-performance-sustained-notes`.
Observe/app instrumentation, external measurement/analysis, collector ingestion/archive and Observer presentation
remain separate. No monorepo runtime/dependency changes. This step does not close full F or overhead acceptance.

## Fixed work, actual background exports

One trusted click starts 64 deterministic degraded jobs with 100ms target spacing. Each job uses one actual Observe
manual-probe interaction and one synchronous measured compute operation. The async scheduler waits until each
absolute target, rechecks early timer wakeups and retains late jobs without skipping or overlapping them. All
first/zero/quantized observations remain. Endpoints are synchronous job/body completion, not React commit, paint,
INP or native presentation. Work spans about 6.3s/run: this is **bounded paced work, not established stationarity**,
long-duration leak evidence or a production-load acceptance test.

One identical production-profiling artifact is used in disabled, diagnostic and production_like. Disabled retains
independent clocks/checksums/no-op Observe and loads no SDK-bearing assets or OTLP. Diagnostic produces 64 roots
and 64 children; production_like keeps 64 roots and aggregates. Both enabled modes produce two cumulative
histogram series: work count=64 and interaction count=64 at the final checkpoint.

Actual public BatchSpanProcessor settings are queue2048/batch512/scheduled delay500ms, document-hide flush disabled;
PeriodicExportingMetricReader interval1000ms. These are experiment settings, not SDK production defaults. There is
no explicit flush during workload, and batch capacity cannot be reached by this fixture. At least three successful
public exporter callbacks per signal must start and complete strictly within the browser workload window. Timers
start during SDK initialization, before ready; their phase relative to the click is retained, not synchronized.

Public wrappers delegate to unmodified stock HTTP exporters, recording span IDs or histogram counts, entry/completion
times and every callback outcome/count. Every callback must complete exactly once successfully. Original browser
POST bodies must match archived record SHA-256/byte counts; their IDs/counts must match callback witnesses and
replayed storage. Finalized captures include every span and each received cumulative checkpoint. **Never sum
cumulative checkpoint counts**: repeated 64 at finish still means 64 observations per series. No extra auxiliary
serializer runs in the measured app. Callback/time witnesses remain part of enabled-mode cost.

## Windows, repetitions and uncertainty

Six fixed permutations of three modes produce 18 fresh Chrome processes/profiles/contexts, six independent run pairs
per contrast. Positions and within-block ordered neighbours balance; no randomization. Viewport1280x800/DPR1/visible,
250ms settling, no requested CPU/network throttling. All runs/first jobs retained; no timing-based exclusions or
rerun selection. OS cache/thermal/power are unmeasured. Jobs are repeated work inside runs, not independent replicas.

A separate SDK-free busy/retained-page-touched64MiB calibration precedes primary work. External CDP/macOS ps samples
bracket workload and SDK finish separately. CPU covers all threads of all renderers, including spares; browser/GPU/
collector/harness excluded. Stable renderer PIDs and coarse CPU-source agreement are mandatory. RSS is an endpoint
sum that can double-count shared pages, not private heap/peak/allocation/leak evidence. Startup CPU unavailable.

Work CPU includes timers, periodic exports, witnesses, click/UI/automation. The finish bracket includes provider
shutdown and evaluation; evidence cloning/capture finalization happen after both process windows. The harness
retains original HTTP bodies while work runs; harness CPU is excluded. Periodic exports can also occur between
body completion and drain. No host/browser clock alignment or additive pure-network CPU claim. Concurrent drain
callers share one promise; concurrent evidence/finalization callers share another, verified in every browser run.

Two selected modes × eight endpoints =16 descriptive selected-minus-disabled contrasts. Each preserves six paired
run IDs/values and all6^6=46656 empirical paired-block bootstrap resamples for exploratory95% nearest-rank mean
intervals. Exchangeable blocks, small n, fixed order and unmeasured host conditions limit inference. No p-values,
multiplicity correction or accepted overhead threshold. Negative differences/zero-spanning intervals do not prove
speedup/equivalence. Earlier C/burst/auxiliary protocols use different artifacts/endpoints and are not matched controls.

## Run and preserve

From sibling `performance-observability`, Node24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-sustained
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-sustained -- reports/<session>
```

Preserve the whole session: source/tools/lock/all entries, build/maps, protocol/settings/environment/backend hashes,
calibration, original CDP/ps snapshots and host brackets, all target/start/end/lateness/checksum samples, callback
witnesses, original HTTP bodies, captures/manifests, analysis JSON/HTML/screenshots. Offline replay validates hashes,
source/build/run associations, job/periodic/final populations and exact archive-body identity. Observer reads typed
per-run reports with attached analysis; statistics/instrumentation do not move into the frontend. Passing means
integrity passed. Startup CPU/queue-drop/peak/accepted budget remain explicitly unavailable.

## Final local result — 14 November 2026

Session `sustained-1794653710827-cd15`, Chrome157.0.8103.78:18 passed/finalized,1152 jobs;1152 received spans,
168 received cumulative points,216 requests,1149819 OTLP body bytes. Each enabled run records 10 successful trace
exports and6 successful metric exports fully inside workload;11 trace+7 metric requests total. Cumulative counts
are `[7,17,27,37,47,57,64]` for **each** of the two series, not their sum. Disabled has no SDK/exports/received points.
Calibration detects0.708115s renderer CPU and+73.578MiB endpoint RSS for the known-load fixture.

Selected-minus-disabled paired mean differences [exploratory95% intervals]:

| Mode | Workload CPU, ms | SDK-finish CPU, ms | Paced body, ms | RSS after work, MiB |
| --- | --- | --- | --- | --- |
| diagnostic | -46.784 [-90.867,-7.362] | 2.123 [1.782,2.431] | -5.733 [-9.733,-1.583] | 14.94 [3.87,29.01] |
| production_like | -78.003 [-130.887,-35.833] | 2.467 [1.967,2.827] | -0.550 [-3.333,1.650] | 10.19 [-3.95,27.01] |

CPU seconds are converted to milliseconds only in this table. These are observed conditional whole-configuration
differences. Negative workload CPU intervals do not establish causal acceleration, acceptable overhead or equivalence.
Job medians also differ; this fixture cannot separate JIT/cache/timer scheduling/host effects from instrumentation.
Fixed pacing makes body duration largely a schedule endpoint, not unrestricted throughput. Finish is separately
reported; app shutdown mean differences36.533ms/36.467ms overlap external finish and must not be added as pure CPU.
All16 contrasts, paired endpoints, job timestamps/checksums and callback/HTTP evidence remain in JSON/HTML.

102 JS +8 Python tests, typecheck/build pass. Real Observe/SDK mode semantics cover all64 jobs/interactions,
early timer wakeups/overruns; validation tests reject deferred/failed/duplicate callbacks, future/regressing or
unfinished cumulative populations, schedule/checksum/phase/membership corruption. Four mutations caught: eliminate
100ms pacing, ignore required periodic exports, ignore failed callback, allow SDK assets in disabled. Sources restored
before the first/final primary collection; no pilot or timing-selected rerun. Six temporary-copy corruption checks
reject samples/callbacks, process/HTTP receipts, raw OTLP, manifest, frozen scheduler and missing run membership.
Original evidence unchanged; offline analysis byte-identical. Prior nine A/B/CPU/pipeline/serializer/metric/mode/burst/
auxiliary analysis hashes remain unchanged. Final UI/analysis screenshots inspected:18 passed/72 explicit unavailable
values, zero page errors.

Analysis SHA-256:`5ea800a1059b195be5138e88fff4469ade285f86b1ddd8dd0fda45241b90e127`.
Source identity:`e49e323e0e8b4a52fe5c6a8578c8dbaf20699a4387fab71052a9c7878ba3ca17`.
Saved viewer:`http://127.0.0.1:4333/performance?report=sustained-1794653710827-cd15`.
Temporary collection servers close; older saved viewers remain unchanged. No new dependencies/native build or
Observe/Observer runtime changes. Packed backend0.3.35 reuses installed dependencies via symlink, not a clean install.
This experiment Git repository has no remote; reports are ignored local artifacts. Preserve the entire session.

Next: monitor on/off and stripped-build comparisons; longer-duration stationarity only with an explicit duration/
convergence protocol. Startup CPU, compression/wider retry faults, accepted overhead budget, full F and native physical
D/E/F acceptance remain open.

C regression `cost-source-1794653897903-70fb` passes9 fresh runs/90 actions/all3 modes on the expanded artifact,
including no SDK-bearing assets/OTLP in disabled.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
