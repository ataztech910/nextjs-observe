# F auxiliary probe/SDK/serializer/export configurations

After monorepo merge #110 (`ea5cfea`), the sibling experiment at local commit `91c61ad` adds
`/aux.html` with six experimental app configurations. The monorepo branch is `step-performance-auxiliary-notes`. They are
not new public Observe modes. Observe/app code collects, an external harness samples processes and computes
statistics, collector/archive own ingestion/storage, and Observer reads the existing typed report/attachments.
No instrumentation or statistics move into the frontend. This step does not close full F or overhead acceptance.

## Six states, same artifact and work

Each fresh page executes one trusted synchronous body of 128 deterministic degraded jobs with the real Observe
manual probe and independent job clocks/checksums. No await/yield/per-job UI. All first/zero/quantized observations
remain. Completion is handler-body completion, not React commit, paint/INP or native presentation. Independent job
clocks/checksums and no-op-probe work remain in disabled.

| Configuration | Probe mode / injected clock calls | Metric SDK | Trace SDK / ended holder | Selected finish | OTLP received |
| --- | --- | --- | --- | --- | --- |
| disabled | disabled / 0 | absent | absent | no-op | none |
| clock_probe | diagnostic / 258 | API no-op | API no-op | no-op | none |
| aggregate_only | diagnostic / 258 | real ManualReader | API no-op | collect, shutdown | none |
| spans_no_export | diagnostic / 258 | real ManualReader | real provider, 129 ended spans | collect, shutdown | none |
| serialize_only | diagnostic / 258 | real ManualReader | same 129-span holder | collect, trace+metric serialization, shutdown | none |
| full_export | diagnostic / 258 | real ManualReader | same 129-span holder | collect, stock trace+metric exporters, shutdown | 129 spans + 2 points |

The counted public probe clock is called twice for the interaction and twice for each job: 258. It adds witness
increments to every enabled probe configuration. **clock_probe is not bare performance.now cost**: the actual Observe
probe still creates context/attribute objects and calls public API no-op spans/instruments. Aggregate-only adds a real
meter but retains API no-op tracing. SDK states load common SDK-bearing modules; aggregate-only constructs neither
a trace provider nor exporter. Disabled/clock_probe load no SDK-bearing asset. Initialization is before workload;
ready wall includes setup, but startup CPU is not validated.

Real trace states use a bounded public SpanProcessor holding ended spans, not a BatchSpanProcessor or private SDK
queue. No periodic reader, background export or retry fault here. No bodies may be sent during workload. Empty
finalized archives for intentionally local/no-export states represent the selected contract, not failed delivery;
original SDK inputs and local cumulative metrics are preserved as sidecar artifacts. Each SDK state has one final
work histogram count=128 and interaction histogram count=1, never pooled as independent runs.

## Separately bracketed finish and evidence

Before→after-work and after-work→after-selected-finish external CDP/macOS ps snapshots give independent renderer
CPU/RSS intervals. Selected finish does one ManualReader collect, optional public serialization or real stock
export, and provider shutdown. Both exporter callbacks must complete successfully; failures reject drain even if
other cleanup succeeds. SDK providers shut down on failure too. Concurrent drain callers share one promise; so do
concurrent evidence/finalization callers. The harness verifies these barriers in every browser run.

**Input projection, base64 conversion and capture finalization happen after both process windows.** Thus finish
CPU excludes this evidence projection/archive work, unlike previous burst/C finish endpoints. Public ended-span/
ResourceMetrics witnesses preserve root/child contexts, attributes/events/exact SDK timestamps, resources/scopes and
cumulative histogram values. Offline public upstream serializers must reproduce original serializer-only bytes or
the actual full-export HTTP bodies byte-for-byte. No duplicate auxiliary serialization is inserted into stock export.
This bounded root+128-child fixture is not a general ReadableSpan reconstruction API. Source/build/maps, transformer
package and installed Node serializer identity are retained.

Configurations differ in retained objects, initialization, JIT/cache state and observers. Their contrasts are
**conditional whole-configuration differences**, not an additive decomposition into pure clock/metric/span/network
CPU. Never subtract serializer-only timing from export and label the residual pure network. Prior C/burst datasets
use different code/settings/endpoints/artifacts and are not matched controls for this experiment.

## Design, process scope and uncertainty

Six cyclic rotations × six states = 36 fresh Chrome processes/profiles/contexts. Positions balance once each;
ordered neighbours/carryover do not. Fixed order, no randomization, 1280x800/DPR1/visible, 250ms settling, no requested
CPU/network throttling, no timing exclusions/rerun selection. Separate SDK-free busy/retained-64MiB calibration must
pass before any primary run. All threads of all renderers in one dedicated Chrome, including spares, are included;
browser/GPU/collector/harness processes excluded. Stable PIDs and coarse CDP/ps CPU agreement are required. RSS sums
can double-count shared pages; not private heap, peak, allocation volume or leaks. Host/browser clocks are not aligned.

Five selected states × eight run endpoints = forty descriptive selected-minus-disabled contrasts. Each retains six
independent run pairs/IDs/original endpoint values. Exploratory 95% percentile mean intervals enumerate all
6^6=46656 empirical paired-block bootstrap resamples with nearest-rank endpoints. Exchangeable-block assumption,
n=6, fixed order and unmeasured thermal/power/OS caches limit population/causal claims. The 768 jobs/state are not
768 independent replications. No p-values/multiplicity correction/accepted percentage. Negative differences or
zero-spanning/collapsed intervals do not establish speedup/equivalence/low overhead. Full F remains open.

## Run and preserve

From the sibling `performance-observability` repository with Node 24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-aux
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-aux -- reports/<session>
```

Preserve the whole session: source/tools/lock/all app entries, build/maps, transformer source, protocol/settings/
environment/backend identity, CPU/RSS calibration and original snapshots, host work/finish brackets, all job
checksums/clocks/probe clock counts, original SDK input witnesses and serializer-only bytes, actual HTTP bodies,
callback outcomes, raw captures/manifests and deterministic analysis JSON/HTML/screenshots. Replay checks hashes,
run/build/source joins, six-state policy, parent/source/IDs, local/captured aggregate counts and byte equivalence.
Observer shows per-run measurements plus attached paired analysis; no statistical computation happens in the UI.
Passing means integrity checks passed. Queue/drop/peak/startup-CPU/accepted-budget values remain unavailable.

## Final local result — 14 November 2026

Session `auxiliary-1794651983557-c494`, Chrome 157.0.8103.78: all 36 integrity checks pass/finalize;
4608 jobs, 2322 locally held SDK spans and 48 local cumulative metric points across SDK states. Only full_export
sends bodies: 774 received spans/12 points. Every run has zero exports before finish. Probe counts are 0 for disabled
and 258 for each enabled run (7740 counted probe-clock calls total). SDK-free calibration detects 0.703792 s CPU
and +73.641 MiB endpoint RSS for the known busy/retained-allocation fixture.

Selected-minus-disabled paired mean differences [exploratory 95% intervals]:

| State | Workload CPU, ms | Selected-finish CPU, ms | Synchronous body, ms |
| --- | --- | --- | --- |
| clock_probe | -4.644 [-14.062, 2.528] | 0.193 [0.064, 0.324] | -4.417 [-12.750, 1.350] |
| aggregate_only | 0.973 [-3.926, 4.546] | 0.685 [0.546, 0.823] | 2.367 [-2.517, 6.133] |
| spans_no_export | -3.028 [-13.664, 7.272] | 0.626 [0.331, 0.856] | -6.233 [-17.700, 4.467] |
| serialize_only | 8.527 [-9.715, 26.519] | 2.170 [1.940, 2.469] | 3.483 [-13.100, 19.367] |
| full_export | 6.275 [-5.911, 16.240] | 6.096 [5.705, 6.506] | 2.083 [-9.200, 11.833] |

Original CPU seconds are converted to milliseconds only in this table. All workload CPU/body intervals span zero;
no speedup/equivalence or accepted overhead follows. Finish differences include SDK collect/cleanup plus external
sampling/evaluation/UI; no subtraction isolates pure network. All forty contrasts and every paired run endpoint
are retained in analysis.json/HTML. No-op finish timers can quantize to zero without implying zero process cost.

Serialize-only original trace+metric body bytes total 94953–94967/run, none sent; full-export received bytes
94901–94955/run. Byte equality is verified **within each run** against its original SDK inputs. Different run IDs,
kind/resource attributes, trace IDs and timestamps mean batches across configurations are not byte-identical controls.
Full export invokes no extra auxiliary serializer; only the stock exporter performs its own serialization.

Six temporary-copy corruption checks reject SDK inputs/clocks/original bytes, process/HTTP receipt, raw OTLP,
manifest, frozen projection helper and missing membership; original evidence unchanged. Replay is byte-identical.
Previous A/B/CPU-source/trace-pipeline/serializer/metric-delivery/repeated-mode/burst replay hashes remain identical.
C regression `cost-source-1794652146369-bbc0` passes nine fresh runs/90 actions/all three modes, including no SDK
asset loading/export in disabled. Observer shows 36 passed rows/144 explicit unavailable values, zero page errors;
final analysis/UI screenshots inspected. Development pilot and pre-final validation session are separate; the
final protocol additionally fingerprints the Node projection/policy/backend helper modules, before collection.
No timing-based selection or primary-run exclusion was applied.

Analysis SHA-256: `8849a5877baeb42c565440fd9b81c4732f52ca79b7ef27fac475773ea30d54b5`.
Source identity: `de02b8c636a919817f2ff20f58a6c8d6ae739de989451c2b562559be97d904b0`.
Saved viewer: `http://127.0.0.1:4332/performance?report=auxiliary-1794651983557-c494`.
Temporary collection servers close; older saved viewers remain unchanged.

95 JS + 8 Python tests and typecheck/build pass. Tests use real Observe/SDK configuration semantics, 258 counted
clock calls, parent-preserving serializer equality, real stock HTTP export and HTTP400 failure. Four mutations
caught: ignore clock accounting, ignore original serializer bytes, ignore stock HTTP identity, ignore shared finish.
Sources restored before primary collection. Development sessions remain separate from the final dataset.
No new dependency/native build or Observe/Observer runtime change. Packed backend 0.3.35 reuses installed
dependencies via symlink, not a clean install. This repository has no remote; raw reports are ignored local artifacts.
Preserve the full session alongside the local experiment commit.

Next: steady-state, monitor on/off and stripped-build comparisons, then overhead acceptance against explicit
requirements. Startup CPU, compression/wider retry faults, full F and native physical D/E/F acceptance remain open.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
