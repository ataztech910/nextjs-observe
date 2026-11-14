# F synchronous burst — one interaction, 128 jobs

After monorepo merge #109 (`bf62563`), the sibling experiment at local commit `66d86ca` adds
`/burst.html`. The monorepo branch is `step-performance-burst-notes`. Observe and app-local code
collect telemetry, the external harness samples processes/computes statistics, collector/archive own ingestion and
storage, Observer presents the existing scenario report and verified attachments. Monorepo runtime is unchanged.

## Design and endpoints

One trusted Playwright click calls 128 deterministic degraded computations **synchronously**, with no await, task
yield or per-job UI/automation. All 128 seeds/checksums/job clocks, including first/zero/quantized observations, are
retained. App performance.now brackets cover each selected call and the complete interaction body; the body timer
includes interaction setup/end, job clocks and result-array recording. DOM completion updates follow the body timer.
Completion is **synchronous handler-body completed**, not React Profiler commit, paint, INP or native presentation.
The plain DOM entry does not render React. Earlier C run timings have different endpoints/artifacts, not a matched
control or direct overhead comparison against this new burst fixture.

All three modes use the identical frozen build and exact work/seeds:

- disabled keeps the independent clocks/checksums and no-op Observe probe; no SDK-bearing asset loading or OTLP;
- diagnostic emits one interaction root and 128 selected-work child spans, plus aggregate histograms;
- production_like emits one root and aggregate histograms, without selected-work child spans.

SDK initialization remains outside the workload interval. One SDK-free calibration runs first (>=700ms busy plus
retained page-touched 64MiB) with the existing independent renderer CPU/RSS adapter. Each condition uses fresh Chrome/
profile/context, 1280x800/DPR1/visible page, no requested throttling, 250ms settling. Six fixed permutation blocks give
18 runs; mode positions and ordered within-block neighbours balance. No randomization, warmup/timing exclusions or
extra rerun selection. The 768 jobs/mode are observations inside six runs, not 768 independent replications.

Shared app/harness settings freeze trace queue=2048, batch=512, scheduled delay=30s, document-hide flush disabled,
and metric interval=60s. The 129-span diagnostic trace is below both queue and batch limits. This is deliberately
bounded batching for a many-span burst, not production defaults, saturation, maximum trace size or a loss-rate study.
Actual HTTP receipts must show **zero exports before finish**. Finish shuts down real SDK providers, checks exporter
callback failures before finalization, and exports two final cumulative histograms: selected-work count=128 and
interaction count=1. These populations must not be exchanged or pooled as independent runs. Queue/drop/peak values
remain unavailable here; previous fault gates retain their own separate validated queue/delivery evidence.

Three external CDP/macOS ps snapshots give separate before→after-burst and after-burst→after-finish CPU/RSS intervals.
Scope includes all threads of all dedicated-browser renderer processes, including spares; browser/GPU/collector/
harness processes excluded. Stable PIDs and coarse CDP/ps CPU agreement are required. RSS endpoint sums can count
shared pages repeatedly; not private heap, peak, allocation volume or leak evidence. Snapshot acquisition/brackets
remain in scope. Workload process window includes click/automation/UI completion; finish includes shutdown/export,
archive finalization/download/UI/automation. App shutdown wall overlaps finish; neither is pure network/serializer/
SDK-flush CPU. Host/browser clocks are not aligned. Startup CPU remains unavailable; ready is measured as host wall.

## Paired uncertainty

Six independent selected-minus-disabled run differences per endpoint, with exact run IDs. Eight endpoints × two
selected modes give sixteen descriptive contrasts: workload/finish CPU, RSS after burst, app burst body, within-run
job median, ready wall, workload wall and app shutdown timer. Exploratory 95% percentile intervals of the arithmetic
mean enumerate all 6^6=46656 empirical paired-block bootstrap resamples, using nearest-rank endpoints. No Monte Carlo
seed, job-level pooling, p-values, multiplicity correction or accepted overhead percentage. Exchangeable-block
assumption, six sequential blocks, fixed order and unmeasured thermal/power/cache limit causal/population claims.
Negative differences and intervals spanning zero never prove speedup, equivalence or acceptable overhead.

## Run and preserve

From the sibling `performance-observability` repository with Node 24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-burst
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-burst -- reports/<session>
```

Save the whole session: source/tools/lock/all app entries, frozen build/maps, protocol/settings/environment/backend
identity, independent calibration and original CDP/ps snapshots, host workload/finish brackets, trusted-input flag,
all app job clocks/checksums, actual browser HTTP body receipts and pre-finish export count, raw captured OTLP and
manifests, deterministic analysis JSON/HTML/screenshots. Replay verifies hashes/membership/build/source identity,
shared settings, process units/population, every seed/checksum/clock, body counts/bytes, root/child source/trace/parent/
completion marker and the two different final cumulative histogram populations. Derived JSON is byte-identical.

Observer shows per-run measurements and attached JSON/HTML with all paired contrasts. Passing rows mean evidence
integrity passed, not accepted performance. Explicit unavailable values are startup CPU, queue/drops, peak memory
and accepted budget. UI performs no instrumentation or statistical computation.

## Final local result — 14 November 2026

Session `burst-study-1794650515193-73b6`, Chrome 157.0.8103.78: all 18 integrity checks pass/finalize,
2304 synchronous jobs, 780 received spans and 24 final cumulative metric points. All runs have zero exports before
finish. Calibration detects 0.703755 s CPU and +73.641 MiB endpoint RSS in the independent known-load fixture.

Selected-minus-disabled paired means [exploratory 95% intervals]:

| Endpoint | diagnostic | production_like |
| --- | --- | --- |
| Workload renderer CPU, ms | 13.671 [6.666, 19.391] | 3.563 [-3.636, 11.273] |
| Finish renderer CPU, ms | 7.330 [6.590, 8.526] | 5.098 [4.768, 5.605] |
| RSS after burst, MiB sum | 3.188 [1.656, 4.466] | 1.607 [-0.182, 2.745] |
| Synchronous burst body, ms | 7.233 [1.717, 11.433] | 4.800 [-0.217, 9.900] |
| Within-run job median, ms | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| Navigation-to-ready wall, ms | 24.689 [15.842, 33.918] | 27.328 [12.287, 44.659] |
| Workload wall, ms | 12.621 [2.165, 21.744] | 2.268 [-6.816, 8.403] |
| App shutdown timer, ms | 36.300 [32.717, 40.800] | 27.433 [25.867, 29.133] |

Original CPU seconds are converted to milliseconds only in this table. Observed app burst body ranges are disabled
978.1–995.2 ms, diagnostic 986.0–997.8 ms and production_like 980.7–999.6 ms. Equal rounded job medians and collapsed
intervals reflect quantization/small sample, not zero instrumentation cost. Diagnostic workload CPU/body contrasts
are positive in these data; production_like intervals span zero. Neither result supplies a performance budget,
population-level causal conclusion or equivalence/speedup claim. Finish differences include external UI/archive work.
The disabled shutdown timer measures the app's no-op flush call and can quantize to zero; it is not SDK flush cost.

Received body bytes/run: disabled 0, diagnostic 95676–95715, production_like 3924–3974. Diagnostic receives one root +
128 children/run; production_like one root/run; both have work count=128 and interaction count=1, disabled none.
All original bytes/IDs/counts/source joins reconcile. Observer shows 18 passed rows/72 unavailable values, zero page
errors; final analysis/UI screenshots were inspected. Six temporary-copy corruption checks reject job samples,
process/HTTP receipt, raw OTLP, manifest, frozen build and missing membership; originals unchanged. Replay is byte-identical.

Previous A/B/CPU-source/trace-pipeline/serializer/metric-delivery/repeated-mode replay hashes remain unchanged.
C regression `cost-source-1794650685588-8609` passes nine fresh runs/90 actions in all modes, including disabled with
no SDK asset loading/export. A separate first regression attempt `cost-source-1794650603119-e56b` failed the RSS
calibration threshold before any C actions (runs=[]); it remains incomplete. Its cause is not established. The
separate regression retry and successful development burst pilot are not pooled into this final burst dataset;
no primary timing run was excluded or rerun-selected.

Analysis SHA-256: `6639af9f24a082dc9a18a245a6a3caf06433bf606e9728b02d88cb2c29c7c990`.
Source identity: `4c7526d9dca0825db885c6d33f1014ec1b4fd63c655bc8da871b785f60aa5150`.
Saved viewer: `http://127.0.0.1:4331/performance?report=burst-study-1794650515193-73b6`.
Temporary collection servers close; older saved viewers remain unchanged.

90 JS + 8 Python tests and typecheck/build pass. Tests use the real installed Observe probe in all modes to check
synchronous 128-job execution, span populations, distinct histogram counts and first/zero retention. Four mutations
caught: missing job, accepting untrusted input, ignoring early export and ignoring trace parent. Sources restored
before final collection; development pilot is separate. No new npm dependency or native build. Packed backend
0.3.35 reuses installed dependencies via symlink, not a clean install. This repository has no remote; raw reports
are ignored local artifacts. Preserve the full session alongside its local experiment commit.

Next: steady-state, auxiliary clock/aggregate/spans-without-export modes, monitor on/off and stripped-build
comparisons, then overhead acceptance against explicit requirements. Startup CPU, compression/wider retry faults,
full F and native physical D/E/F acceptance remain open.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
