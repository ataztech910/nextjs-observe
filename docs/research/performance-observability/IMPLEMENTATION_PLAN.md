# Implementation roadmap

This roadmap was created during research; implementation was subsequently authorized by the user.

Implementation update, 2026-11-11: the first T1 increment is implemented on `step-performance-otlp-traces`:
known trace-field preservation (typed source projection, exact timestamps, links/scope/schema/flags/dropped counts),
bounded atomic validation with OTLP error responses, retained-window deduplication including detector input,
and conservative completeness metadata. Existing query fields and span-only adapters remain compatible.
682 tests pass (4 real-model tests skipped), typecheck/build pass, three mutation checks detect regressions,
and the packed collector/UI were exercised with an upstream exporter and in a browser.
Unknown wire fields are not archived; durable raw capture belongs to T3. This does not claim full OTLP conformance.
T2 Metrics, T3 run capture/replay, new timeline/comparison UI and experimental apps remain unimplemented.
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
