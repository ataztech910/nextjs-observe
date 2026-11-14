# F browser observers on/off with fixed diagnostic Observe

After monorepo merge #112 (`9014ce8`), the sibling experiment at local commit `b82649c` adds
`/monitor.html`. Monorepo branch: `step-performance-monitor-notes`.
Observe/app instrumentation, external measurement/statistics, OTLP collector/archive and Observer frontend retain
separate responsibilities. No instrumentation/statistics move into the UI and no monorepo runtime/dependency changes.

## Exactly what is toggled

The app monitor creates three actual PerformanceObservers: `event` (durationThreshold16ms), `longtask` and
`long-animation-frame`, each unbuffered (`buffered:false`) with a retained-record capacity2000/type. Entries use
their public JSON projection, recursively serialized immediately inside the observer callback or final takeRecords
drain. This handles nested browser host objects such as TaskAttributionTiming, which cannot be structured-cloned
from the shallow longtask toJSON result. Projection/allocation/callback cost is part of this selected monitor cost.

On creates the observers immediately before the first job and drains/disconnects immediately after the last job.
Stop is idempotent; already queued callbacks after stop are ignored. Setup failure disconnects created observers.
No buffer overflow is accepted for this bounded comparison. Off constructs/observes/drains nothing and collects no
entries; missing browser observations are unavailable, not evidence of no jank. The same artifact still contains
monitor code. Common monitor-object setup/empty buffers and independent clocks/checksums remain in both groups.

This is a focused disposable configuration using the same browser source types as experiment A. It does not toggle
A's complete buffered/lifecycle collection, web-vitals/onINP, JS timer heartbeat, rAF polling, React Profiler, native
frame/JS sources, SDK queue monitoring or the external CPU/RSS harness. Broad JS/native monitoring overhead remains
open. No SDK export is added for browser entries; original browser observations stay separate JSON evidence.

An independent SDK-free `/monitor-check.html` control runs a trusted180ms busy task, once with observers off and
once on in fresh Chrome processes. Off must construct/collect nothing; on must receive a genuine longtask through
an actual callback. All three source types must be supported before any primary run. Quiet paced jobs can yield
zero longtask/LoAF entries. Published pending records are drained; entries not yet published when stop runs may be
absent, including observations related to the last task. This fixture is not full page-lifecycle INP coverage.

## Fixed instrumentation and workload

Observe stays **diagnostic in both groups**, including its real SDK and periodic OTLP export. Six adjacent pairs
alternate off→on/on→off, three each:12 fresh Chrome processes/profiles/contexts,64 deterministic degraded jobs/run
with absolute100ms targets, one trusted click starts all. Each job is an Observe interaction plus measured sync work:
64 roots+64 children. The unchanged shared scheduler retains first/late/quantized jobs, no skips or parallel jobs.
All primary observations retained; no timing exclusions or timing-selected reruns. Completion is plain DOM body
completion, not React commit/paint/INP; ~6.3s paced work does not establish stationarity, unrestricted throughput,
long-session leaks or production-load behavior.

Actual SDK settings match the preceding paced fixture: trace queue2048/batch512/delay500ms/hide flush disabled,
metric interval1000ms. No explicit flush during work. At least three successful public stock-exporter callbacks per
signal must start and complete inside work. IDs/counts and original browser POST bytes/hashes reconcile collector
archive and offline replay. Two cumulative histogram series each finish at64; repeated checkpoints are never summed.
Resources/run IDs/variant attributes vary between fresh runs: serialized batches are not identical controls.

External CPU/RSS sampling, Playwright and HTTP witnesses remain enabled in both groups. A separate SDK-free busy/
retained-page-touched64MiB calibration validates CPU/RSS sources. Three external CDP/macOS ps endpoint snapshots
bracket work and SDK finish separately. Work includes monitor setup/callback/deep JSON projection/drain/disconnect,
periodic export, timers, click/UI/automation. SDK finish includes provider shutdown/evaluation. Final evidence cloning/
archive finalization follow both process windows. Concurrent drain and evidence/finalization share one promise each,
verified in every browser run. Other instrumentation remains and is not subtracted as additive pure phase CPU.

CPU includes all threads of all renderers (including spares), excludes browser/GPU/collector/harness. Stable PIDs
and coarse CDP/ps agreement required. RSS endpoint sums can double-count shared pages, not private heap/peak/leak.
Host/browser clocks not aligned, startup CPU unavailable. Visible1280x800/DPR1,250ms settling, no requested CPU/network
throttling. Fixed order, no randomization; thermal/power/cache unmeasured.

Eight descriptive on-minus-off endpoint contrasts retain six exact paired run IDs/values. All6^6=46656 empirical
paired-block bootstrap resamples yield exploratory95% nearest-rank mean intervals assuming exchangeable blocks.
Six pairs, not384 independent jobs/state; small n/fixed order/unmeasured host conditions limit causal/population claims.
No p-values/multiplicity correction, accepted budget or equivalence criterion. Negative/zero-spanning intervals do
not establish speedup/equivalence/acceptable monitoring cost. Prior studies use different artifacts/protocols and
are not matched controls.

## Run and preserve

From sibling `performance-observability`, Node24, installed Chrome and a packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-monitor
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-monitor -- reports/<session>
```

Preserve whole session: source/lock/tools/all HTML entries/build/maps, protocol/environment/backend identities,
CPU/RSS calibration and browser source controls, original job target/start/end/lateness/checksums, process snapshots/
raw ps/host brackets, browser source/callback/drain/record evidence, SDK callback/HTTP witnesses, raw OTLP/manifests,
analysis JSON/HTML/screenshots. Offline replay verifies hashes, source/build/run/policy/population/parent associations
and callback/body/archive identity. Observer presents existing typed reports/attached analysis. Passing means integrity
passed. Startup CPU, producer queue/drops, peak memory and accepted budget remain explicitly unavailable; off browser
evidence has a separate unavailable reason.

## Final local result — 14 November 2026

Session `monitor-1794679904079-986a`, Chrome157.0.8103.78:12 passed/finalized,768 jobs,1536 received spans,
168 cumulative metric points,216 requests/1422374 OTLP body bytes. Each run, in either monitor state, completes
10 successful trace+6 successful metric callbacks inside work and11 trace+7 metric requests overall. Both final
histogram populations are64. Checkpoints are `[7,17,27,37,47,57,64]` except block4/off `[6,16,26,36,46,56,64]`,
reflecting reader phase relative to work; never sum them.

On constructs3 observers/run, receives1 callback/11 Event Timing entries/run:66 Event Timing entries total,
zero longtask/LoAF entries and zero dropped records in primary on runs. Off constructs/collects nothing.
Independent180ms controls separately show on callbacks3/event11/longtask1/LoAF1 and all-zero off observer evidence.
The primary workload is quiet for longtask/LoAF: these results do not quantify high-volume callback handling or
all JS/native monitor configurations. The known-task records are source validation, not pooled primary samples.
CPU/RSS calibration detects0.693522s CPU and+73.484MiB endpoint RSS.

On-minus-off paired mean differences [exploratory95% intervals]:

| Endpoint | Mean difference [interval] |
| --- | --- |
| Workload renderer CPU, ms | -35.928 [-70.612,6.108] |
| SDK-finish renderer CPU, ms | -0.251 [-0.490,-0.016] |
| RSS after work, MiB | 2.094 [0.388,4.214] |
| Paced workload body, ms | 0.883 [-0.333,2.567] |
| Within-run job median, ms | -1.333 [-2.333,0.150] |
| Navigation-to-ready wall, ms | -5.706 [-40.216,29.547] |
| Workload wall, ms | -2.641 [-8.739,4.945] |
| SDK shutdown wall timer, ms | -0.167 [-8.933,9.100] |

CPU seconds are converted to milliseconds only in this table. Negative/zero-spanning results do not establish
speedup, equivalence or acceptable cost. RSS is a noisy endpoint sum, not private retained memory or leakage.
Navigation completes before monitor start and is a balance/context endpoint, not monitor startup cost. Monitor
registration/stop and deep projection occur during work; the finish contrast does not isolate their cost.
All eight contrasts and original pairs/endpoints are retained in attached JSON/HTML.

109 JS+8 Python tests/typecheck/build pass. Tests cover off without browser access, exact unbuffered registrations,
bounded retention/drop accounting, pending-record drain, repeated stop/late callbacks, setup cleanup, real diagnostic
mode delivery, known-task control, lifecycle/population/membership corruption and nested host-object JSON projection.
Five mutations caught: activate off monitor, discard pending records, accept late callbacks, accept silent known-task
source, remove deep JSON projection. Sources restored before primary collection. Seven temporary-copy corruption
checks reject monitor samples/callbacks/records, process/HTTP receipt, OTLP, manifest, frozen helper, membership and
independent source check. Original evidence unchanged; deterministic replay byte-identical. Prior ten A/B/CPU/
pipeline/serializer/metric/mode/burst/auxiliary/paced analysis hashes unchanged. Packed reader12 passed/54 explicit
unavailable values/zero page errors; final analysis/UI screenshots inspected.

Development attempt `monitor-1794679854848-753c` stopped during independent source validation with DataCloneError
from nested TaskAttributionTiming, before any primary run. It remains incomplete with frozen sources/protocol/error.
Deep JSON projection was fixed, its regression test and fifth mutation added, all checks rerun; final primary
collection is separate. No primary timing-based exclusion or selected rerun.

Analysis SHA-256:`333cf2d65e05eee106f72807891bc8e730f0df9caee0f0a5a49307af961ca12d`.
Source identity:`f61b640e55e27297e7ae69ff64f0a0fc016877942ea9dc3ed0313dff3feb4e32`.
Saved viewer:`http://127.0.0.1:4334/performance?report=monitor-1794679904079-986a`.
No new dependencies/native build or Observe/Observer runtime changes. Packed backend0.3.35 reuses installed
dependencies via symlink, not a clean install. Experiment Git has no remote; ignored reports remain local, preserve
whole session. Temporary collection servers close; older saved viewers remain unchanged.

Next: stripped-build comparison. Other JS/native monitors, external harness observer effect, longer-duration
convergence, startup CPU, compression/wider retries, accepted overhead budget, full F and physical native D/E/F remain open.

C regression `cost-source-1794680046207-7d19` passes9 fresh runs/90 actions/all3 modes on the expanded artifact,
including no SDK-bearing assets/OTLP in disabled.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
