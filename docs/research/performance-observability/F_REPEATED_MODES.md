# F repeated runtime-mode study on C

After monorepo merge #108 (`391e853`), the sibling experiment at local commit `178259a` compares
three existing Observe modes on the unchanged C degraded
workload. App instrumentation stays in Observe/the app; external CPU/RSS and statistics stay in the harness;
collector/archive and Observer presentation retain their own responsibilities. No instrumentation moves into UI.
This is one measured F increment, not completion or an accepted overhead budget.

## Predeclared design

Six blocks contain all six permutations of disabled, diagnostic and production_like, three runs/block. Each mode
occupies every position twice; each ordered within-block neighbouring pair appears twice. Order is fixed, not
randomized. Each run has a fresh dedicated Chrome process/profile/context, viewport 1280x800, DPR1 and visible page.
All 18 use one frozen production-profiling artifact and identical C degraded work/checksums, 30 sequential trusted
Playwright clicks, 250ms settling and requested 16ms inter-action waits. No warmup exclusion or timing-based rerun.
First/zero/quantized observations stay in the population. Actual host action brackets are retained; Playwright/UI/
OS scheduling affects spacing. This is not a true steady-state, saturation, burst or large-trace experiment.

Disabled retains React Profiler, the independent harness and the no-op Observe probe but loads no SDK-bearing
asset and exports no OTLP. Diagnostic records root+selected-work spans and histograms; production_like records
root spans and aggregate histograms. This runtime comparison does not remove SDK bytes from the common artifact,
measure normal release React, or estimate monitor on/off/probe installation overhead. No stripped build is used.

External browser-level CDP cumulative process CPU and macOS ps CPU/RSS snapshots are calibrated in a separate
SDK-free busy/page-touched retained-64MiB workload. All threads of all renderers of one dedicated browser, including
spares, are included; browser/GPU/collector/harness processes excluded. Stable renderer PIDs and coarse CDP/ps
agreement are required. RSS is a sum of endpoint resident sizes and can double-count shared pages: not private heap,
peak, allocation volume or leak evidence. Snapshot acquisition/brackets are retained and affect the windows.

Three process snapshots give two separate intervals: before work → after 30 actions, and after work → after finish.
The first includes scheduled trace export that occurs during the workload. The second includes remaining trace/
metric shutdown plus automation, UI updates, archive finalization and download; it is not isolated SDK flush CPU.
App shutdown time is also retained, as are external navigation-to-ready/workload/finish wall times. These endpoints
overlap: do not add overlapping wall/SDK/process durations. Startup CPU is unavailable because no stable-PID startup
interval is validated. Handler-to-commit ends at the Profiler callback, not paint/INP. No host/browser clock alignment.

## Run-level uncertainty

The unit of comparison is the independent run, paired within block, not the 180 actions/mode. Every run and all six
selected-minus-disabled differences are retained for seven endpoints: workload CPU, finish CPU, after-work RSS,
within-run handler median, navigation-to-ready wall, workload wall, and app shutdown timer. Two modes × seven
endpoints = fourteen descriptive contrasts, with exact baseline/selected run IDs and original endpoint values.

For each contrast the arithmetic mean paired difference has an exploratory 95% percentile interval from **all
6^6 = 46656 ordered empirical paired-block bootstrap resamples**. Nearest-rank 2.5%/97.5% endpoints; no Monte Carlo
seed, action-level pooling, p-value, multiplicity-corrected significance test or performance pass threshold.
This assumes exchangeable blocks; six sequential blocks on one Mac, unmeasured thermal/power state, OS caches and
fixed order limit population/causal interpretation. Negative differences and intervals spanning zero remain shown;
they do not establish speedup, equivalence or acceptable overhead. Quantized sub-millisecond medians need care.

## Run and preserve

From the sibling `performance-observability` repository with Node 24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-modes
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-modes -- reports/<session>
```

Preserve the entire session: source/tools/lock and all app entries, frozen build/maps, protocol/environment/backend
identity, CPU/RSS calibration and all original CDP/ps snapshots, host action/work/finish brackets, app samples,
actual browser OTLP receipts, raw captures/manifests and deterministic analysis JSON/HTML/screenshots. Replay checks
hashes, membership, artifact/source joins, process population/units, every action/checksum, exporter body counts/bytes,
root/child source/parent/commit associations and each final cumulative histogram's count/temporality. Histograms
remain separate per run. Queue/drop/peak/startup-CPU and accepted-budget values are explicitly unavailable here;
the previous fault gates retain their own narrower queue/delivery evidence.

Observer reads the existing scenario contract: 18 passed integrity rows and 72 unavailable values, with per-run
measurements and verified attachments. The full paired contrasts/intervals are in attached analysis JSON/HTML;
Observer performs no statistical computation. A passing row means evidence checks passed, not overhead acceptance.

## Final local result — 14 November 2026

Session `mode-study-1794649546330-cc4e`, Chrome 157.0.8103.78: all 18 integrity checks pass/finalize;
540 actions, 540 received spans and 36 final cumulative metric points. Disabled receives no OTLP/SDK-bearing assets.

Selected-minus-disabled paired mean differences (exploratory 95% intervals):

| Endpoint | diagnostic | production_like |
| --- | --- | --- |
| Workload renderer CPU, ms | -0.697 [-22.406, 21.079] | -9.290 [-32.763, 12.042] |
| Finish renderer CPU, ms | 5.639 [4.874, 6.504] | 3.490 [2.703, 4.310] |
| RSS after workload, MiB sum | 4.646 [3.628, 6.013] | -1.107 [-18.208, 10.810] |
| Handler run median, ms | 0.100 [0.100, 0.100] | 0.083 [0.050, 0.100] |
| Navigation-to-ready wall, ms | 42.976 [-27.254, 109.117] | 52.300 [-34.950, 132.042] |
| Workload wall, ms | -32.865 [-96.408, 18.870] | -28.035 [-97.974, 54.168] |
| App shutdown timer, ms | 36.367 [32.100, 42.250] | 33.833 [30.433, 39.833] |

CPU seconds in the original analysis are converted to milliseconds only in this table. Workload CPU and wall
intervals span zero: this does not establish improvement, equivalence or low overhead. Positive finish CPU includes
shutdown/archive/download/UI work, not pure SDK flush. Handler median contrasts are close to browser clock
quantization; collapsed displayed endpoints do not imply exact population-level certainty. No percentage or budget
is accepted. Calibration detects 0.710172 s CPU and 73.609 MiB endpoint RSS rise in the SDK-free known-load run.

Original received OTLP body ranges/run: disabled 0; diagnostic 65260–65389 B; production_like 44487–44608 B.
These include actual scheduled trace exports during workload and final shutdown bodies; they are not total HTTP
or network bandwidth. Fourteen contrasts retain every paired difference/run ID in analysis.json.

Six temporary-copy corruptions reject app samples, process/action receipts, raw archived OTLP, manifest, frozen
build and missing run membership; original evidence stays unchanged. Deterministic replay is byte-identical.
Previous A/B/CPU-source/trace-pipeline/serializer/metric-delivery analysis hashes remain identical. This session
itself exercises C across all modes (18 fresh runs, 30 actions each); no extra timing-selected regression is mixed in.
Observer shows 18 passed rows/72 unavailable values with zero page errors; final screenshots were inspected.

Analysis SHA-256: `0a1f487accccb8364c9bf31b967423ddb7469649930925cc612b0af8f297eae6`.
Source identity: `a08f4e2037fe0d073a676488818526aa43e0a1b0e338d0182fc2b522b89c0658`.
Saved viewer: `http://127.0.0.1:4330/performance?report=mode-study-1794649546330-cc4e`.
Temporary collection servers close; older saved viewers remain unchanged.

86 JS + 8 Python tests and typecheck/build pass. Four mutations caught: wrong bootstrap block weights, conflated
finish CPU, wrong paired baseline membership and missing action receipts. Sources restored before final collection.
Verification retains separate pilot/final sessions and all final independent runs without timing exclusions.
Packed backend 0.3.35 uses installed dependencies via symlink, not a clean installation. No new dependency,
Observe/Observer runtime change or native build. This repository has no remote; raw reports are ignored local
artifacts. Preserve the complete session alongside its local experiment commit.

Next: steady/burst/large-trace, auxiliary modes, monitor on/off and stripped-build comparisons, then overhead
acceptance against explicit requirements. Compression, wider retry/timeout faults, full F and native physical
D/E/F acceptance remain open.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
