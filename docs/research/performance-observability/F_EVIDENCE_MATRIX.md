# F evidence and remaining acceptance gates

Checkpoint: 14 November 2026, after merge #114 (`a923623`). **There is reproducible local evidence for ten scoped
F protocols. Full experiment F and an acceptable-overhead claim remain open.** This page is the current entry
point; the linked gate documents retain their original methods, measurements and historical next-step notes.

The [machine-readable evidence index](F_EVIDENCE_INDEX.json) pins analysis/protocol/report hashes, report membership,
source commits and expected delivery/archive states. It is a documentation inventory, not an Observer report schema,
new benchmark, pooled analysis or acceptance score. Raw sessions remain local ignored artifacts in the sibling
`performance-observability` Git repository, which has no remote. The index does not publish those artifacts.

## Responsibilities and current implementation

| Layer | Actual implementation and responsibility |
| --- | --- |
| Observe | [`packages/next-observe/src/performance.ts`](../../../packages/next-observe/src/performance.ts) supplies explicit interaction context, selected synchronous work, histograms and disabled/diagnostic/production_like modes. App-local adapters configure SDKs and measurement sources. Existing Next bootstrap/loader/proxy remain separate. |
| External experiment harness | The sibling repository executes Playwright/Maestro scenarios, controls faults, acquires independent observations, preserves artifacts and computes protocol-specific statistics. It owns the F analyses and their uncertainty. |
| OTLP ingestion/storage | [`server.ts`](../../../packages/next-observer/src/collector/server.ts) accepts traces and supported metrics; [`memory-storage.ts`](../../../packages/next-observer/src/collector/memory-storage.ts), [`metric-storage.ts`](../../../packages/next-observer/src/collector/metric-storage.ts) and [`capture.ts`](../../../packages/next-observer/src/collector/capture.ts) own normalized storage, raw request archives, finalization and replay. These backend components reside in the next-observer package; their location does not make them frontend instrumentation. |
| Report reader and Observer UI | [`performance-reports.ts`](../../../packages/next-observer/src/collector/performance-reports.ts) validates typed report/artifact/archive associations. The [`Performance page`](../../../packages/next-observer/ui/src/pages/performance-page.tsx), [timeline](../../../packages/next-observer/ui/src/components/run-timeline.tsx) and [metric evidence](../../../packages/next-observer/ui/src/components/metric-evidence.tsx) present external reports and archived telemetry. They do not run scenarios, collect app performance or recompute the F study statistics. |

The existing receiver, archive and reader handled all ten F protocols. This consolidation changes documentation
and its evidence index. It introduces no instrumentation, runtime, dependency, native build, report schema or
statistical algorithm. Open acceptance work belongs first in requirements and measurement protocols; it does not
justify moving instrumentation into Observer or replacing its frontend.

## Requirement coverage

“Scoped” means evidence exists for the stated fixture/source. “Partial” means part of the original requirement
is measured. Neither label means general product acceptance or a production guarantee.

| F requirement | Evidence now | Boundary still open |
| --- | --- | --- |
| Independent CPU | Scoped: calibrated CDP plus macOS ps, all threads of all renderers in a dedicated Chrome; stable PIDs and coarse agreement required. [Source gate](F_PROCESS_SOURCES.md). | Browser/GPU/collector/harness CPU and exact JS-thread CPU are excluded. No physical RN CPU or validated startup-CPU interval. |
| Memory | Partial: original endpoint RSS snapshots, raw ps output and known retained-allocation response. [Source gate](F_PROCESS_SOURCES.md). | Summed RSS can double-count shared pages. Private heap, allocation volume, high-water/peak and leak evidence remain unavailable. |
| Runtime modes and latency | Scoped: [18 repeated C runs](F_REPEATED_MODES.md), one profiling artifact, separate work/finish windows and run-paired uncertainty. | Profiler callback is not paint/INP; timings overlap. No normal React release-versus-profiling comparison or production budget follows. |
| Trace queues/drops/delivery | Scoped: [real SDK fault gate](F_PIPELINE_GATE.md), queue16/batch4, observed queue size and exporter in-flight ledger; 20 deliberate queue-full drops remain visible. | Two-snapshot queue high-water is generally a lower bound. Controlled saturation is not a fleet loss rate or representative-load memory bound. |
| Metric export/retry | Scoped: [503 retry, 400 rejection and held callbacks](F_METRIC_DELIVERY_GATE.md). Callback errors survive resolved reader flush; original cumulative checkpoints remain separate. | Bounded functional cases, not a broad retry/network/compression cost matrix. Failed delivery stays failed. |
| Serialization | Scoped: [public upstream JSON serialization and stock export](F_SERIALIZER_GATE.md), original SDK inputs and within-run byte equality. | Stock export follows auxiliary serialization and can be warmed. Callback latency includes several costs; subtraction does not isolate pure network CPU. |
| Burst and paced work | Partial: [128 synchronous jobs](F_BURST_STUDY.md) and [64 paced jobs with actual periodic exports](F_SUSTAINED_STUDY.md), all first/late observations retained. | Burst fits the configured batch/queue limits. About 6.3s paced work is not established stationarity, saturation, long-duration memory or production workload acceptance. |
| Auxiliary attribution | Scoped: [six conditional configurations](F_AUXILIARY_STUDY.md), counted probe clocks, real aggregates, held spans, serializer-only and full export. | clock_probe includes context/attributes/no-op API/witness cost. These are experimental states, not new public modes or an additive pure-phase decomposition. |
| Monitor distortion | Partial: [event/longtask/LoAF observers on/off](F_MONITOR_STUDY.md), fixed diagnostic SDK and independent known-longtask control. | Primary on runs contain 11 Event Timing entries and zero longtask/LoAF entries each. High-volume callbacks, full INP lifecycle, other JS/native monitors and external harness observer effect remain unmeasured. |
| Stripped output and startup wall | Scoped: [two actual builds](F_STRIPPED_STUDY.md), shared work/source hashes, no Observe/OTel in stripped output, loaded versus emitted byte joins. | Plain DOM build policy, not npm install/disk footprint or React/native release comparison. Startup wall is not startup CPU. |
| Telemetry volume | Scoped: original OTLP request bodies, record IDs/counts, manifests and replay reconcile under each protocol. | Received-only archive coverage does not prove complete production. Body bytes are not total socket/TLS cost; cumulative checkpoints must not be summed. |
| Compression/receiver cost | Open: asset gzip/Brotli sizes and backend protocol handling do not measure OTLP compression or receiver CPU/capacity. | A representative declared compression/transport/receiver-load protocol and independently validated sources are required for those claims. |
| Native and device acceptance | Open: [iOS Release Simulator bootstrap/cadence](IOS_NATIVE_CADENCE.md) and [system profiler gate](IOS_SYSTEM_PROFILER_GATE.md) supply scoped functional evidence. | Simulator callback cadence/signposts are not physical presented frames/hitches. Physical Release D/E/F and independently validated native CPU/memory/presentation remain open. |
| Acceptable overhead | Open: no agreed budget or equivalence/acceptance rule. | Define intended claim, workload/build/device/environment, endpoints, repeat design and requirements before declaring acceptable overhead. Never invent a passing percentage. |

## Dataset register

Counts below are inventory counts, not a statistical pooling unit. Each protocol has its own population, settings,
endpoints and analysis. Calibration, pilots, C regressions and A/B data are outside these 140 F presentation rows.
The first source gate correctly retains capture experiment=C because it measures the unchanged C app for an F prerequisite.

| Gate / method | Frozen local session | Report rows and actual delivery |
| --- | --- | --- |
| [CPU/RSS source](F_PROCESS_SOURCES.md) | `cost-source-1794606600135-3f62` | 9 passed |
| [Trace pipeline](F_PIPELINE_GATE.md) | `pipeline-1794641370737-5d72` | 2 passed, 1 incomplete overflow, 1 failed HTTP400 |
| [Serializer](F_SERIALIZER_GATE.md) | `serializer-1794644023258-125f` | 8 passed |
| [Metric delivery](F_METRIC_DELIVERY_GATE.md) | `metric-1794646414485-258d` | 4 passed, 1 failed HTTP400 |
| [Repeated runtime modes](F_REPEATED_MODES.md) | `mode-study-1794649546330-cc4e` | 18 passed |
| [Synchronous burst](F_BURST_STUDY.md) | `burst-study-1794650515193-73b6` | 18 passed |
| [Auxiliary configurations](F_AUXILIARY_STUDY.md) | `auxiliary-1794651983557-c494` | 36 passed |
| [Paced periodic export](F_SUSTAINED_STUDY.md) | `sustained-1794653710827-cd15` | 18 passed |
| [Browser monitor on/off](F_MONITOR_STUDY.md) | `monitor-1794679904079-986a` | 12 passed |
| [Installed disabled versus stripped](F_STRIPPED_STUDY.md) | `stripped-1794680848671-8f54` | 12 passed |

There are 137 passed, 1 incomplete and 2 failed report rows. The corresponding archives are 137 finalized and 3
unfinalized. Raw `run.json` is draft metadata; the existing replay layer derives incomplete state when no
`finalized.json` exists. A completed fault-validation session can correctly contain failed/incomplete delivery.
These states must remain unchanged; neither a session's `complete` flag nor a resolved flush is acceptance of delivery.
There is no meaningful combined success percentage or pooled overhead estimate across these ten protocols.

## Conference claims supported by this evidence

The examples can demonstrate mode-dependent span/aggregate populations, explicit delivery loss/failure, cumulative
metric semantics, conditional cost configurations, external CPU/RSS observations and build-dependent JS bytes.
Present an endpoint together with its source, build policy, independent run count and uncertainty. Keep separate:

- selected synchronous work, handler-to-Profiler completion, paced body, process CPU and startup wall;
- endpoint RSS, private/peak memory and retained allocations;
- producer records, exporter calls, HTTP attempts and received records;
- cumulative histogram checkpoints and distinct observations;
- loaded gzip bodies and total emitted artifacts;
- native callback cadence, native presentation and JS scheduling delay.

For the two stripped fixtures, loaded gzip JS is 1871 B versus 8275 B. Installed-minus-stripped navigation to
adapter-ready is +21.433 ms [1.450, 44.650] under the declared exploratory paired interval. This readiness precedes
artifact/archive setup; the result combines two-build loading/evaluation/setup effects. Its work-CPU interval spans
zero. These facts do not establish general installation cost, pure probe CPU, acceptable overhead or speedup.
Do not subtract timings from different studies or add overlapping phases into a total.

## Remaining decisions and closure order

| Priority | Next concrete result | What would close it |
| --- | --- | --- |
| 1 | Choose the intended F claim and acceptance contract. | State whether the talk shows scoped comparisons or asserts a product budget. A budget requires explicit requirements/endpoints/target builds/devices/environment and a declared decision rule; the current value remains null. |
| 2 | Freeze a representative sustained-work protocol for the selected target. | Declare workload rate/cardinality/concurrency, SDK settings, duration/window or convergence rule, thermal/power/cache controls, run ordering/repetitions and exclusion rules before collecting. Preserve all first/late/failure evidence and run-level uncertainty. |
| 3 | Validate only the missing sources needed for that claim. | Startup CPU needs a defensible acquisition interval; private/peak memory and queue high-water need validated sources. Monitor on/off must cover the selected monitoring configuration. Compression/retry/receiver cost requires its own scoped controls. These are measurement tasks in the app/harness/backend, not frontend instrumentation. |
| 4 | Complete physical native gates if D/E/native F are claimed. | Pinned physical Release/Hermes execution, source availability, clock uncertainty, independent native system corroboration and repeated-device evidence. Simulator success cannot substitute for this. |
| 5 | Make the acceptance decision against the frozen contract. | Publish every run/fault state and original artifacts, then apply the declared rule. If no product budget is agreed, present the measured comparisons and keep acceptable overhead/full F open. |

The open rows describe unsupported claims; they are not a requirement to build every extension before showing the existing demos. For the conference, the current scoped comparisons can be used with their limitations and without an acceptable-overhead guarantee. Only the gates needed for the selected claim should become mandatory.

No further benchmark is silently chosen by this consolidation. Preparing the contract/protocol can proceed without
changing Observer; collecting a representative performance result depends on the declared target and conditions.

## Verification and use

This checkpoint replays the 10 F analyses plus the separate A/B analyses byte-for-byte using their pinned algorithms
and retained packed backend 0.3.35. No original dataset is edited and no new performance observations are pooled.
The current 114 JS and 8 Python tests pass. Five deliberate mutations of temporary inventory copies—accept F, remove
a dataset, erase a failure count, alter an analysis hash and relabel a failed fault—are rejected by the inventory check.
This is documentation/data verification, not a new measurement algorithm or a new test of performance acceptance.

An independent packed-reader/browser audit copies original report/artifact/capture bytes unchanged into local
`reports/f-evidence-audit-1794683490367`, validates all 10 reports and checks all 140 displayed statuses and explicit
unavailable values. No browser page errors. Trace overflow remains incomplete; trace/metric HTTP400 remain failed.
The existing archive-list limit is 100 runs per directory ([capture.ts](../../../packages/next-observer/src/collector/capture.ts)). The flat 140-run audit copy permits explicit-ID validation but cannot be a healthy archive-list viewer. Review copies are split into two shelves: `groups/sources-and-components` (7 reports/98 runs, `http://127.0.0.1:4336/performance`) and `groups/paced-monitor-builds` (3 reports/42 runs, `http://127.0.0.1:4337/performance`). Each lists its own original report IDs within the existing bound; list/dropdown/visible-alert checks are included. These are convenience copies, not a merged report, a capacity benchmark or replacements for full original source/build sessions.

To replay from the sibling experiment repository, use Node 24 and the matching retained backend. Each index entry
supplies `analysis.replayTool` and `sessionId`, for example:

```sh
OBSERVER_PACKAGE_ROOT=/path/to/matching/packed-observer/package \
node tools/strip-analysis.mjs reports/stripped-1794680848671-8f54
```

Repeat for the ten registered tools/sessions. Their existing replays validate source/build/protocol/backend and
archive/report associations under their own contracts; the documentary index additionally pins analysis/report
hashes and expected membership/states. Packed dependencies reuse the installed graph by symlink, not a clean
installation. Raw artifacts are not Git-published; preserve full original sessions and their local source commits.

Evidence-index SHA-256: `f59f8144c370c0be58d24cdd3e2fd188830326f63afcb47088cec7cea6acea11`.
