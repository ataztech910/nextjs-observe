# Implementation roadmap

Latest follow-up (12 November 2026): [actual iOS Release Simulator scheduling workload](IOS_SCHEDULING_SCENARIO.md)
adds idle/blocked JS timer evidence and a native-driver animation request. Native frame/presentation and physical
acceptance remain open; earlier inventory/status entries below describe their respective implementation stages.

This roadmap was created during research; implementation was subsequently authorized by the user.

Latest system gate (12 November): [actual Simulator profiler capability/evidence](IOS_SYSTEM_PROFILER_GATE.md).
Time Profiler + app signposts are recorded and validated; Animation Hitches reports unsupported on this platform.
Physical hitch/presentation and conference acceptance remain open.

Implementation update, 2026-11-11: the first T1 increment is implemented on `step-performance-otlp-traces`:
known trace-field preservation (typed source projection, exact timestamps, links/scope/schema/flags/dropped counts),
bounded atomic validation with OTLP error responses, retained-window deduplication including detector input,
and conservative completeness metadata. Existing query fields and span-only adapters remain compatible.
682 tests pass (4 real-model tests skipped), typecheck/build pass, three mutation checks detect regressions,
and the packed collector/UI were exercised with an upstream exporter and in a browser.
Unknown wire fields are not archived; durable raw capture belongs to T3. This does not claim full OTLP conformance.
T1 was committed as `0bf961e` and pushed to `origin/step-performance-otlp-traces`.

T2 implementation update: `step-performance-otlp-metrics` adds Sum/Gauge/explicit Histogram ingestion in JSON/protobuf/gzip,
an independent metric-store capability, atomic validation/dedup/conflict handling, exact typed point metadata,
and a paginated raw-point query with conservative per-point quantile bounds/estimates. ExponentialHistogram/Summary
are explicitly rejected. Cumulative checkpoints/resets and late points stay separate; no cross-point aggregation
or rate conversion is claimed. Shared validation/protobuf primitives are reused by both signal paths.
731 tests pass (4 real-model tests skipped), typecheck/build pass, four mutation checks detect regressions;
a real MeterProvider → upstream serializers → packed receiver smoke and browser API check pass.
T1/T2 have since been merged into `master` (merge `046d1c8`).
T3 implementation update: `step-performance-run-capture` adds explicit header-selected run partitions, typed
allowlisted same-observation predicates, original decompressed JSON/protobuf request archives, versioned
manifests with external artifact hash references, atomic finalization and isolated export/replay. Replay verifies
hashes/inventory/counts; unfinished archives remain incomplete. Run-tagged requests stay separate from live
storage/detector and the existing UI. Frozen records preserve unknown source fields; decoded projections retain
the currently supported subset. `coverage: received-requests-only` never asserts complete producer delivery.
755 tests pass (4 real-model tests skipped), typecheck/build and four mutation checks pass; packed upstream-SDK
capture → restart → export → repeated replay and browser API checks pass. This is bounded local archive storage,
with full-run replay on append/query; no capacity/throughput or physical native claim is made.
First T6/T9 increment (`step-performance-hook-experiment`): Observe adds a framework-independent manual
`performance` entry point with explicit interaction contexts, sync callback-body spans/histograms and three
collection modes. Next becomes an optional peer for using the independent entry point. A standalone app-local
React profiling experiment C is implemented in the sibling `performance-observability` Git repo, with a real
browser SDK/exporter bootstrap, controlled variants, artifact hashes, completion markers, capture and deterministic
report tooling. 108 Observe tests and four mutations pass; the packed Observe tarball was installed into the
standalone app and all nine variant/mode combinations passed a three-sample browser smoke. This validates the
pipeline, not the conference statistical acceptance gate. RN/native bootstrap, bounded instrumentation cost/drop
accounting, independent-run studies and new timeline/comparison UI remain outstanding. Existing Next-specific
bootstrap still does not emit these metrics automatically.
UI increment (`step-performance-runs-ui`): the Observer Performance page now browses explicit archived runs,
source/clock/build metadata, paginated spans and raw metric points; an optional read-only external report capability
shows generic run-median comparisons with exact run membership, declared endpoints/limitations and separate external
sample counts/warmup. Hashes/schema/run association are verified by the backend; statistical computation remains in
the external harness. Instrumentation remains in Observe. This is an initial T4/T5/T8 presentation increment, not a
replacement trace viewer or a full track/exemplar/comparison implementation. 764 Observer tests pass (4 skipped),
typecheck/build and four mutations pass; the packed UI/backend were checked against the real 27-run frozen session.

Runner/report increment (13 November): Observer additionally reads `observe.scenario-report/v1`, with checks,
passed/failed/incomplete states, explicit unavailable measurements and verified artifact/capture associations.
The external experiment repo provides a Playwright functional producer and browser verification against the packed
backend/UI. Maestro has a real Simulator UI flow and external JUnit/commands adapter; see [Maestro gate](MAESTRO_GATE.md).
See [scenario reports](SCENARIO_REPORTS.md). This does not close native presentation or repeated-performance gates.

Experiment A increment (13 November): four matched desktop navigation/interaction blocks plus two excluded CDP
CPU/timeline diagnostics run through the unchanged scenario reader. Pinned Lighthouse JSON, lifecycle INP/browser
observations, source maps and raw OTLP are retained with deterministic replay and mutation/corruption checks.
See [A gate](EXPERIMENT_A_GATE.md). This does not close field/mobile, statistical inference or native/overhead gates.

Experiment B increment (13 November): one identical artifact, different configured startup work, four matched
blocks and two excluded gated CPU/timeline diagnostics. All six JS byte measures have 0% paired difference against
a predeclared 2% tolerance; selected compute and navigation-to-ready differ consistently. Artifact gzip/Brotli bytes,
ResourceTiming, Network cache flags, server receipts and raw OTLP are verified on replay. The unchanged Observer
reads ten scenario rows. See [B gate](EXPERIMENT_B_GATE.md). Next web step is F with independent cost sources;
physical native presentation and D/E/F acceptance remain open.

First F source gate (13 November): an external CPU/RSS adapter validates renderer process scope against CDP and
macOS ps, detects a known busy/retained-allocation workload, then records three balanced mode blocks on unchanged C.
Disabled has independent process data and no SDK asset loading/export; actual raw OTLP and browser body counts
reconcile. See [F process sources](F_PROCESS_SOURCES.md). This is a T10 prerequisite, not overhead acceptance:
producer queues/drops, steady/burst workload, serialization/export decomposition, monitor on/off and stripped build
remain next; native physical-device gates are unchanged.

F trace-pipeline gate (14 November): upstream SDK self-observation, public exporter callbacks and original HTTP
bodies now reconcile produced/queued/dropped/failed/received spans under actual held responses and HTTP400.
Queue=16/batch=4 are deliberate test settings. Overflow and rejected archives remain unfinalized; Observer displays
passed/passed/incomplete/failed. A callback drain barrier preserves earlier in-flight completion and prior errors.
See [F pipeline validation](F_PIPELINE_GATE.md). Isolated serialization, retries/metric-exporter queues, monitor
on/off/auxiliary/stripped-build comparisons and full overhead/native acceptance remain open.

F auxiliary serializer gate (14 November): the public upstream JSON serializer is measured separately before
an unchanged stock export of the same ended SDK batch. Auxiliary bytes, stock HTTP body and offline upstream
replay match exactly in eight fresh runs; each whole phase has independent renderer CPU/RSS snapshots. First and
zero-duration samples remain included. See [F serializer evidence](F_SERIALIZER_GATE.md). Fixed phase order warms
export; callback time includes its own serialization and is not pure transport. This is auxiliary evidence, not
full F overhead acceptance. Metric-exporter/retry/compression and repeated modes/monitor/stripped builds remain.

F metric delivery gate (14 November): the real PeriodicExportingMetricReader and stock browser metric exporter
now preserve callback failures separately from resolved reader flushes, retry actual HTTP503 with byte-identical
bodies, and wait for a held initial callback before shared shutdown. Healthy/retry/held receive two distinct
cumulative checkpoints (four points each, never summed); HTTP400 stays failed/unfinalized with zero received.
See [F metric delivery](F_METRIC_DELIVERY_GATE.md). No queue/drop values, compression cost or accepted overhead
are inferred. Next is repeated mode/steady-burst/auxiliary/monitor-on-off and stripped-build comparison; full F
and physical native acceptance remain open.

F repeated runtime modes (14 November): [six paired permutation blocks](F_REPEATED_MODES.md) now compare
18 fresh Chrome runs/540 trusted actions on unchanged C degraded using one profiling artifact. Separate workload
and finish CPU/RSS, exact action receipts, raw OTLP and fourteen paired run-endpoint contrasts replay deterministically.
Exploratory 95% intervals enumerate all 6^6 empirical paired-block bootstrap resamples. Workload CPU contrasts span
zero; finish CPU differences are positive but include shutdown/archive/download/UI. No equivalence, causal speedup
or acceptable overhead budget follows. Steady/burst/large-trace, auxiliary/monitor-on-off/stripped-build comparisons,
startup CPU and physical native gates remain open.

F synchronous burst (14 November): [one interaction/128 jobs](F_BURST_STUDY.md) now executes without yielding,
using the existing manual Observe probe in a separate plain DOM entry. Six mode permutations/18 fresh runs retain
2304 jobs, 780 spans and 24 final cumulative points; no exports occur before finish. A deliberately bounded 129-span
trace stays below test batch/queue limits. Workload/finish process intervals and sixteen paired run-endpoint
contrasts replay with exploratory bootstrap intervals. This endpoint is handler-body completion, not React commit/
paint/INP; earlier C data are not a matched control. No saturation or accepted overhead is claimed. Steady-state,
auxiliary/monitor/stripped-build comparisons, startup CPU and physical native gates remain open.

F auxiliary configurations (14 November): [six conditional probe/SDK/serializer/export states](F_AUXILIARY_STUDY.md)
compare disabled, counted probe clocks/API no-op instruments, real aggregates, held spans, serializer-only and stock
export on one artifact. Six cyclic blocks/36 fresh browsers retain independent workload/selected-finish CPU/RSS;
evidence projection/base64/finalization happen afterwards. SDK inputs reproduce original serializer bytes or stock
HTTP bodies. Forty exploratory paired run-endpoint contrasts are configuration differences, not additive pure-clock/
network CPU costs. Probe state is not bare performance.now; these are app experiments, not new public Observe modes.
Steady-state, monitor-on-off/stripped builds, startup CPU and overhead/native acceptance remain open.

F bounded paced periodic-export study (14 November): [64 jobs with100ms targets](F_SUSTAINED_STUDY.md),18 fresh
runs/six mode permutations, actual BatchSpanProcessor delay500ms and metric interval1000ms. Each enabled run has
10 successful trace+6 metric callbacks completely inside work; no explicit work flush. Final cumulative populations
are64 work/64 interactions;7 checkpoints/series are never summed. Callback witnesses/original HTTP bodies/archive
hashes/replay all reconcile:1152 jobs,1152 spans,168 points/216 requests across the study. Separate calibrated work/
SDK-finish CPU/RSS,16 paired exploratory contrasts,102 JS+8 Python tests/4 mutations/6 corruption checks; prior9
analysis hashes unchanged, C9-run regression and packed report18 passed/72 unavailable pass. Observed negative
work CPU differences do not prove speedup or accepted overhead. ~6.3s/run does not establish stationarity.
Monitor on/off, stripped builds, longer-duration convergence, startup CPU, full F/native acceptance remain open.

F scoped browser-monitor comparison (14 November): [event/longtask/LoAF observers on/off](F_MONITOR_STUDY.md)
with Observe fixed diagnostic,6 alternating adjacent pairs/12 fresh Chrome/64 paced jobs/run. Disposable unbuffered
observers,2000 records/type, deep public JSON projection, pending-record drain/disconnect and late callback guard.
Independent trusted180ms source control observes a real longtask; all3 source types required. Final768 jobs/1536 spans/
168 cumulative points/216 requests, no checkpoint summation. On receives11 Event Timing entries/run, no primary
longtask/LoAF; quiet-source case only, not high-volume callback cost. Calibrated CPU/RSS,8 paired exploratory contrasts;
109 JS+8 Python tests/5 mutations/7 corruption checks,10 unchanged prior analysis hashes, C regression and packed
reader12 passed/54 unavailable. Work-CPU interval spans zero; no acceptable budget/equivalence claim. Full A lifecycle/
INP, other JS/native monitoring and external harness on/off remain separate. Next: stripped-build comparison;
longer-duration convergence, startup CPU/full F/native physical acceptance remain open.

The task descriptions below retain the target architecture and acceptance criteria.

## Architecture constraints

Preserve the two products and current public APIs. Observe collects/exports; Observer presents/analyzes. Physical backend receiver/storage remain in `next-observer/src/collector` for the MVP, with distinct responsibilities and OTel contracts. No instrumentation moves into Observer. Native exporters and other language SDKs can bypass Observe. Keep local deployment and independent npm package builds; no workspace or database migration is required just to begin.

Complexity: S = localized change with existing mechanisms; M = several modules and edge-case fixtures; L = cross-layer state/query/protocol work; XL = physical-device/native/version matrix or experimental correctness research. These are relative engineering estimates, not calendar commitments.

## Phase 0 — completed audit

T0 (S): nine research documents, checkout/version inventory and source references, targeted existing test runs. No runtime/dependency modifications. Acceptance: independently review Observe, frontend, receiver/storage; distinguish existing stats/regression from absent metric pipeline and causal performance analysis. Results and limitations in [audit](ARCHITECTURE_AUDIT.md#validation-performed).

## Phase 1 — receive and preserve

| ID / priority / effort | Affected actual package and proposed modules | Dependencies / acceptance |
|---|---|---|
| T1 / P0 / L | `next-observer`: extend `src/collector/{types,decode,protobuf,server,memory-storage}.ts`; proposed typed capture envelope/projection module | Add optional links, full resource/scope/schema/context metadata and exact timestamps/typed integers. Preserve existing ms/query fields. JSON/protobuf parity, unknown-field handling, strict required validation, compliant per-format success/errors/partial-rejection policy, bounded bodies/depth/count. Retried span IDs don't inflate stats; late/orphan data and completeness visible |
| T2 / P0 / L | Same package: proposed `metric-types.ts`, `metric-decode.ts`, `metric-storage.ts`, `metric-query.ts`; `/v1/metrics` routing | T1 envelope contract. Sum/Gauge/explicit Histogram JSON+protobuf with resource/scope/attributes/flags/start/end/temporality/exemplars. Preserve ExponentialHistogram fields or explicitly reject; no silent loss. Raw points kept; cumulative reset/duplicate/order logic tested. No “supported histogram” badge based only on decoding count/sum |
| T3 / P0 / M–L | `types.ts`, `memory-storage.ts`, server query routes; proposed `capture.ts`, `run-manifest.ts` and local capture tooling | T1/T2. Allowlisted equality predicates on span/resource attrs with same-observation semantics; explicit run partitions/manifest. Versioned archive export/replay including external artifact hashes; atomic finalized-run marker, counts, dedup keys, schema version and incomplete-state metadata. No reliance on truncated trace-list response as dataset |

Recommended T1 capture shape: original signal envelope/typed fields + schema_version + source/run/calibration metadata, with normalized spans as a projection. Archive decoding must be version-aware. Preserve unknown protobuf envelope bytes if claiming unknown-field fidelity; extending the current hand-written decoder alone cannot be called lossless future-field preservation. Do not expand the custom protobuf parser to every signal without an explicit maintainability review; compare a focused generated decoder against current no-dependency approach. Any future dependency addition requires implementation review, not action in this research.

Metric MVP API proposal: `GET /api/performance/metrics` selecting run partitions/name/time/allowlisted dimensions; returns typed points, source/temporality, counts/completeness and explicitly labeled quantile estimates. Add an optional performance-store capability alongside the existing public StorageAdapter so third-party span-only adapters continue working. Unsupported adapters expose capability flags and return a clear unsupported response for metric queries. Do not make new metric methods mandatory on the old interface without a major compatibility plan.

## Phase 2 — visualization and comparison

| ID / priority / effort | Affected package / modules | Dependencies / acceptance |
|---|---|---|
| T4 / P0 / M | `next-observer/ui`: `pages/trace-page.tsx`, `lib/waterfall.ts`, `lib/trace-analysis.ts`; proposed `lib/performance-tracks.ts`, event/track/clock components; backend timeline query | T1/T3. Incremental tree/track mode, timestamped events, links/resource/scope details, uncertainty and unknown endpoints. Avoid invented Profiler intervals and causal critical-path claims. Generic foreign service fixtures remain usable |
| T5 / P0 / M–L | UI API/router and proposed comparison page; backend `metric-query.ts` / proposed comparison pure functions | T2/T3. Run/variant/source/device filters; histogram windows and exemplar navigation; raw median/p75/p95/count, null empties, approximate quantile bounds, completeness. Comparison uses explicit selected runs, not inferred “latest version.” Reuse Panel/histogram components |
| T8 / P0 / M | Separate experiment harness/report tooling, optionally documented conversion/capture helpers in this repo | T3 and source contracts. External Lighthouse/native/profile artifacts associated by manifest hash; deterministic report from frozen capture. Run-level statistical analysis stays external; UI navigates results |

T8's numbering reflects a shared dependency rather than execution order; capture protocol should be designed before application experiment work. Static/public UI copy should explain measurement semantics without exposing internal backend implementation details.

## Phase 3 — cross-platform instrumentation validation

| ID / priority / effort | Package / proposed module | Dependencies / acceptance |
|---|---|---|
| T6 / P0 / M–L | `next-observe`: optional explicit performance helpers; app-local RN bootstrap first, potential `src/react-native.ts` export later | T1, then T2 metrics. Browser/Node/RN manual selected work exports with explicit async Context, source/unit/run identity. RN Hermes Android+iOS physical release builds verify Metro/transport/clocks/IDs/lifecycle. No DOM/Next bootstrap in RN; no instrumentation imports from Observer. Existing config/server/client/runtime APIs unchanged |
| T7 / P0 for D/E / XL | Separate native experiment integration or benchmark converter; optional adapter ports in Observe only after validation | T1/T2/T3/T6. Android native frame aggregation/API31+ deadline validation; iOS independently validated cadence/hitch evidence; native startup anchors and typed context boundary. Native collection continues while JS blocked. Clock calibration records uncertainty/drift/resume; source availability explicit |
| T9 / P0 / M | Observe timing/mode helpers and bounded buffers; source map manifest contract, no automatic hook transform initially | T6 and measurement model. Manual hook compute/reducer/effect setup/cleanup, attempt/commit distinction, bounded cardinality, disabled/diagnostic/production_like modes. Existing five-second render aggregate remains compatible; new detailed data explicitly opted in |
| T10 / P0 / L | Measurement harness plus exporter/receiver self-measurements | T2/T3/T6/T7/T9. Counterbalanced overhead study including independent disabled baseline, native CPU/memory, queue/drops/bytes, serializing/exporting/flush cost and probe distortion. Publish measured findings; no fabricated overhead target |

Validate Node/browser before RN; RN native D/E validation starts early as the largest uncertainty. Other SDK interoperability: use real JS and at least one native exporter fixture; add Go/PHP exporter fixtures before declaring those integrations verified. HTTP standards boundary remains compatible in design regardless of framework-specific tracks.

## Phase 4 — deferred product work

P1/P2, after talk-critical gates: build-aware source-map artifact service; optional allowlisted Babel hook transform with compiler/version matrix; cross-build hook identity matching; rich hook flamegraphs with coverage; verified dependency-graph critical path; experiment-specific regression policies/CI reports; native reusable package if justified; durable/indexed storage after measured need; OTLP logs; upstream collector/tail-sampling deployment for scale. Existing version-regression banner remains; don't rebuild it under another name.

A dedicated RN auto-instrumentation SDK, private React dispatcher patching and replacing the trace viewer are not prerequisites.

## Storage and migration

No persisted telemetry exists to migrate today ([MemoryStorage](../../../packages/next-observer/src/collector/memory-storage.ts#L55)); current chat/check/detector state is also outside the proposed performance archive scope. Existing API consumers/tests/third-party StorageAdapter implementations are the migration concern. Add optional fields/capabilities, retain milliseconds, preserve current routes and interpret old normalized data as precision-limited/link-unknown. Never synthesize dropped links or exact nanoseconds from old ms floats.

Archive version 1 should include an explicit schema id, typed envelopes, run/clock/source records and finalized manifest with hashes/counts. Write streaming files with bounded buffers, recover an unfinalized capture as incomplete, replay idempotently, and fail on unknown incompatible versions. Keep external artifact bodies outside span attributes. Retention policies distinguish active in-memory analysis from finalized captures; query responses surface eviction and capture completeness.

Measure receiver/query heap and latency under declared span sizes/metric cardinality before picking new storage. If a durable local indexed store is needed, optional SQLite is lower operational cost than a new distributed service, but still requires migrations/indexes/metric point encoding and adapter contract tests. ClickHouse/Prometheus cannot be justified from an unmeasured capacity issue. Archive-based reporting is sufficient for initial repeatability, with bounded MemoryStorage for live UI.

## Testing and validation strategy

- **Protocol:** independent official-exporter JSON/protobuf/gzip fixtures; links/scopes/resources/arrays/bytes/int64/nanoseconds; malformed/repeated/truncated/oversized inputs; correct response format/status; wrong signal endpoint; retries/dedup; auth and proxy limits. Extend existing collector tests rather than replace them.
- **Metric mathematics:** explicit bucket boundaries/count consistency, signed values where valid, monotonicity, delta/cumulative reset/gaps, out-of-order duplicates, schema mismatch, exponential downscale/negative/zero buckets, exemplar preservation; raw-sample quantile oracle and approximate histogram bounds. Partition/run cardinality tested explicitly.
- **Storage/query:** replay idempotence, finalized/incomplete runs, eviction/truncation, predicates on one observation, resources versus span fields, many services, stable ordering, empty and insufficient samples. Keep original API/adapter test fixtures passing.
- **UI:** current waterfall/self-time/regression assertions plus overlapping lanes, ambiguous clocks, events/links, Profiler scalar events, generic spans, unsupported sources, missing parents/cycles and selected source location. Browser review of a reproducible packed build; do not claim physical native support from mocked UI tests.
- **Observe semantics:** selected callbacks preserve return/throw, cleanup, stable identities, dependencies and hook order; explicit async parentage across awaits and overlapping interactions; no exporter recursion. Babel changes later require compiler output/diagnostic and runtime behavior checks.
- **Physical native:** pinned Hermes release builds on Android/iOS; native-driven animation with blocked JS, independent native jank, lifecycle resume/clock calibration and unavailable APIs. Corroborate native endpoints with system artifacts.
- **Measurement:** independent harness, repeated/counterbalanced workloads, predefined exclusions, raw artifacts, sample counts and overhead source definitions. Stress batching/queues/retention under declared workloads; set performance budgets only from evidence and product needs.

## Conference release gate

A–F each satisfies its [acceptance criteria](EXPERIMENT_SUPPORT.md), replay produces the same counts/statistics, no metric or link silently disappears, all displayed endpoints/sources/quantile approximations are explicit, and raw observations survive live eviction/restart via capture. Physical-device claims have platform-specific validation. Production suitability remains conditional on measured overhead and operational limits; the conference prototype is not evidence of fleet-scale readiness.

### Run timeline increment — 11 November 2026

T4/T5 now also have archive-isolated paginated trace selection, exact-relative-nanosecond span geometry,
selectable commit/event markers and raw resource/scope/link details on the Performance page. Partial traces,
missing parents/cycles, legacy precision and unverified cross-source clock alignment are explicit. Profiler scalars
are not converted into intervals. Metric overlays/exemplar navigation, calibrated runtime tracks, zoom and
virtualization remain open; this increment does not close the conference release gate.

### Metric evidence increment — 11 November 2026

T5 now includes per-point bucket distributions, exact count/value strings, source interval/unit/temporality,
approximate quantile bounds, and exemplar navigation to the same archived run's trace/span. Empty/missing/unbounded
and aggregate-only states are explicit; cumulative checkpoints remain separate. No instrumentation, receiver or
storage behavior changes in this increment. Metric overlays/window aggregation, calibrated/native tracks,
source/device filtering and conference experiment acceptance remain open.

### Native bootstrap feasibility increment — 11 November 2026

After merge #95 (`ce5c771`), the separate experiment repo adds an app-local OTel/Observe adapter, explicit runtime-port
availability, bounded trace batching, serialized lifecycle/manual flush and shutdown, and a Metro iOS / restricted-VM
transport preflight. It validates the pinned dependency graph and packed backend pipeline; it does not validate RN,
Hermes or any native API. Node 24.11.1 was selected because Metro 0.88 excludes host Node 25. No native toolchain was
installed. Native frame/input measurements and queue-drop counts remain unavailable; clock calibration is unverified.

The user has an iPhone, so the next T6 gate is a pinned iOS host plus full Xcode/signing and a physical release run.
T7 iOS cadence/hitch evidence must be validated independently. Android-first physical validation cannot be performed
with the presently available device/toolchain. Existing Android and iOS D/E/F acceptance rules remain open.

### iOS host and Release Simulator gate — 12 November 2026

The separate experiment repo now has an official-template RN 0.88 / React 19.3 iOS app, AppRegistry/runtime
inspection/export-gate screen, AppState wiring and a guarded create → shutdown → verify → finalize controller.
Source identities pin code/native configuration/npm/Ruby/pod locks and the imported Observe helper. Xcode preparation
preserves user Node overrides. CocoaPods resolves 86 pods, and Xcode 26.3 builds the Release Simulator app.

At the user's request, execution moved to iPhone 17 Pro Simulator (runtime reports iOS 26.3.1). Hermes and required
runtime ports are available without additional polyfills. Fresh processes for disabled / diagnostic / production_like
finalize with 0/4/2 spans and 0/4/4 metric points. The existing packed backend/UI consumes these real captures without
Observer runtime changes. Source artifact bodies, build hashes, screenshots and raw archives are retained locally.
The separate restricted-VM controller model remains labelled as a model.

Next: extend the experiment host with the planned JS scheduling/native-driven animation workload and independently
validated iOS cadence/hitch source. Physical-device signing/Release validation remains a separate open gate; Simulator
is useful for functional development but cannot satisfy physical performance acceptance. Clocks remain uncalibrated,
native input/frames unavailable, drops unknown. T6/T7 and D/E/F conference acceptance remain open.


### Independent iOS callback source — 12 November 2026

[CADisplayLink cadence increment](IOS_NATIVE_CADENCE.md) adds app-local native buffering, explicit overflow/lifecycle/
session handling and bounded JS/native clock-pair analysis. Six real Release Simulator conditions plus native
expiry/background/restart checks pass; existing Observer displays the exported callback-interval histogram without
runtime changes. This is a partial T7 source, not frame presentation or hitch validation. Next gate is independent
Instruments/XCTest corroboration with original system artifacts, then physical Release and repeated-device acceptance.
