# Research summary and decisions

## Current implementation checkpoint — 14 November 2026

After merge #114 (`a923623`), executable web experiments and bounded performance data paths exist. The original
11 November baseline below is retained as historical research; its “missing” inventory is not today's status.
The [F evidence matrix](F_EVIDENCE_MATRIX.md) and [pinned index](F_EVIDENCE_INDEX.json) are the current F entry point.

| Responsibility | Implemented evidence now | Remaining scope |
| --- | --- | --- |
| Observe/app instrumentation | Framework-independent [manual performance entry](../../../packages/next-observe/src/performance.ts), explicit contexts and three modes; app-local SDK/bootstrap and selected browser/native sources. | Manual sync work does not expose all React internals, automatic native presentation or a universal RN instrumentor. Existing Next bootstrap remains separate. |
| Receiver/storage | Backend [trace/metric routes](../../../packages/next-observer/src/collector/server.ts), [metric storage](../../../packages/next-observer/src/collector/metric-storage.ts), [raw capture/replay](../../../packages/next-observer/src/collector/capture.ts), validation/preservation and run partitions. | Bounded implemented signal subset, not full OTLP conformance. No log ingestion; ExponentialHistogram/Summary remain unsupported. Received-only archives do not prove complete production. |
| Observer frontend | [Typed scenario reports](SCENARIO_REPORTS.md), [run timeline](PERFORMANCE_TIMELINE.md), [metric evidence](PERFORMANCE_METRICS.md) and explicit unavailable/failed/incomplete states display actual captures. | Calibrated native presentation, metric/window analytics and general capacity claims remain separate. Instrumentation and F statistical computation stay outside the frontend. |
| Web experiments | Executable [A](EXPERIMENT_A_GATE.md), [B](EXPERIMENT_B_GATE.md), selected [C hook work](REACT_HOOK_INSTRUMENTATION.md) and [ten scoped F protocols](F_EVIDENCE_MATRIX.md), with frozen sources/raw artifacts and replay. | These are declared fixture/endpoints; they do not establish universal production performance, pure phase CPU or acceptable overhead. Do not pool protocols. |
| React Native | An app-local adapter, actual Release Simulator/Hermes runs, [callback cadence](IOS_NATIVE_CADENCE.md), [system profiler](IOS_SYSTEM_PROFILER_GATE.md) and [Maestro scenario](MAESTRO_GATE.md) have scoped functional evidence. | Physical Release/native frame-hitch/clock/CPU-memory D/E/F acceptance remains open. A dedicated RN SDK package is still not justified; keep the adapter and validate the target. |

**Decision now:** the existing Observer reader can present the F evidence; another frontend extension is not a
prerequisite for these comparisons. There are 10 F protocols/140 presentation rows, including expected failures,
not 140 pooled benchmark replications. Full F acceptance and an agreed overhead budget remain open. Use the bounded
conference facts with their limits, then choose the intended claim/requirements and only the further measurement
gates that it needs. No general acceptable-overhead or physical native smoothness claim is supported yet.

## Original research baseline — 11 November 2026

The research answers, external-tool survey, priority sequence and original decision matrix below describe the
specified audited checkout. Historical statements such as “no metrics” or “no experimental app” apply to that
original research task, not the subsequently authorized implementation summarized above. External comparisons
were checked on their original date and are not re-audited by this local evidence consolidation.

Research date: 2026-11-11; audited commit `c7278c4b514182efc91dad95413391dbde922de2`.

## Executive answers

1. **Can the project support all six conference experiments today?** No, not end to end. It can ingest manually authored performance spans and show their relationships, attributes/events and duration distributions. Web interaction/hook semantics, OTLP metric points, reproducible run captures and native-frame evidence are missing. See the source-backed [architecture audit](ARCHITECTURE_AUDIT.md) and [experiment mapping](EXPERIMENT_SUPPORT.md).
2. **What exists?** Observe (`next-observe`) provides Next server/Edge setup, browser document/fetch/XHR/errors, selected directive function timing, component-call aggregates, JSON/protobuf server export and batching. The physically separate `next-observer` package bundles a Node HTTP receiver, normalized span MemoryStorage, APIs/analysis/checks/AI and the nested Observer SPA. The SPA already has a multi-service waterfall, attributes/events, self-time, an inferred critical path, span-derived histograms, version comparisons and regression detection. These statements reference [source inventory/pipeline](ARCHITECTURE_AUDIT.md#pipeline-by-stage) and [UI evidence](ARCHITECTURE_AUDIT.md#ui-audit); regression is not a newly missing capability.
3. **Critical gaps:** span links and OTLP metadata/precision are lost; metrics/logs have no ingest/store/query path; no generic attribute/run predicates, durable captures or native/performance collectors; no frame/metric/clock-aware tracks. Current trace-only retention/percentiles are not a general time-series analytics system ([OTel audit](OTEL_COMPATIBILITY.md)).
4. **Is an RN instrumentor necessary?** A minimal explicit RN integration/bootstrap is justified; a new dedicated SDK package is not yet justified. Upstream SDK reuse must be tested on pinned Hermes/Metro builds, and the existing DOM/Next bootstrap cannot be imported unchanged. Native collection or external native benchmarks are required for frame and full-startup claims ([RN decision](REACT_NATIVE_INSTRUMENTATION.md)).
5. **Can manual instrumentation cover the MVP?** Yes for selected hooks/business computations, handlers, interaction/readiness markers and JS responsiveness. It cannot alone expose all React commit internals, native presentation or pre-JS startup. Use native data sources and independently validated endpoints for D/E and RN CPU/memory in F.
6. **Minimum viable implementation:** additive trace preservation + strict validation/dedup; OTLP Sum/Gauge/explicit Histogram; bounded run capture/replay and predicates; manual performance contracts and RN bootstrap; native frame/clock validation; incremental track/metric/comparison UI and external reports. A trace-only demonstration can be an intermediate milestone, not the completed conference scope.
7. **Defer:** automatic universal hook transforms, private React internals, reusable full RN SDK, full source-map backend, causal critical-path reconstruction, advanced experiment regression/CI, logs and distributed storage/tail sampling unless demonstrated necessary. Keep existing version-regression behavior.
8. **Largest risk:** convincing but incorrect attribution: scheduling delay mislabeled CPU; Profiler timestamps mislabeled commit duration; overlapped work summed as total; JS clocks/native events treated as synchronized; commit/rAF/display callback treated as presentation.
9. **Promising differentiation:** an open OTLP workflow joining explicitly attributed selected hook work, user-defined interaction completion and independently collected native frame evidence, with run replay/comparison and visible uncertainty. This is a product hypothesis to validate, not a claim that competitors cannot do it.

## Independent product recommendations

Observe owns app instrumentation and optional platform adapters. Reuse OTel API/function/error/export mechanisms; keep `withObserve`, Vercel bootstrap, Next loader/proxy intact. Add explicit opt-in performance helpers, resource/endpoint configuration and bounded collection modes. A future optional RN entrypoint must avoid DOM/Next initialization and preserve existing exports.

Observer owns display/analysis. Extend the existing waterfall and inspectors with track projection, events/links, source metadata, metric overlays, clock uncertainty and run comparisons. No app instrumentation runs in Observer.

The actual receiver and storage currently live under `next-observer/src/collector`; changes there are backend protocol/storage work, not evidence that the frontend owns ingestion. Extend these layers in place with an optional performance-store capability, preserve current StorageAdapter/API consumers, retain MemoryStorage for live conference use and add versioned local capture/replay. A new database or package split is not required by current evidence.

## Competitive landscape: confirmed capability versus open questions

External documentation was checked on the research date. These are capability-level findings, not benchmark comparisons. “Not established” means the cited materials do not establish the capability; it is not proof the tool cannot implement it. Match actual app/tool/build versions before using these comparisons in the talk.

| Tool / source | Confirmed useful capability | Hook/interaction/native limits and production scope |
|---|---|---|
| [React DevTools source](https://github.com/facebook/react/blob/main/packages/react-devtools/OVERVIEW.md) | React tree inspection, commit profiling, render durations/changed state; profiles import/export | Hook inspection is not exact duration of each hook callback. Development/profiling workflow; don't treat private renderer integration as stable production SDK |
| [React Performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) | React scheduler, component render/effect work aligned with browser timeline | Already covers important React work correlation. Build-dependent; not a generic production per-hook OTLP API |
| [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance) | Main-thread/function stacks, task/render/paint/network timeline; recording can reveal computation called by hooks | Function attribution is not automatic stable hook identity. Controlled local/remote recording rather than ordinary lightweight fleet telemetry; native RN compositor detail needs native tools |
| [Hermes profiling / RN profiling guidance](https://reactnative.dev/docs/profiling) | Sampling JS execution helps locate expensive functions, including selected computation paths used by hooks | Samples estimate execution distribution, not every invocation's exact duration. No claim that every release supports the old `profile-hermes` command or production remote upload; pin tool/build |
| [React Native DevTools](https://reactnative.dev/docs/react-native-devtools) | Current docs describe a Performance panel since RN0.83 with JS execution, React tracks, network and User Timings in one timeline; integrated React Profiler | RN already has unified development timeline capability. Native compositor/presentation analysis remains distinct; no full production hook telemetry guarantee |
| [Flashlight repository](https://github.com/bamlab/flashlight) | Android app performance audits, CLI/E2E/CI workflow for production apps across frameworks | Useful external benchmark corroboration without building a new in-app profiler. Exact React hook timing and a cross-platform OTLP contract are not established by its README |
| [Android Studio profiling](https://developer.android.com/studio/profile), [Perfetto FrameTimeline](https://perfetto.dev/docs/data-sources/frametimeline) | Native CPU/system/frame investigation, thread scheduling and compositor-related frame evidence | Can correlate JS thread work and native frame activity in controlled system traces when markers/clocks are available. Profiling/benchmark setup required; not just JS SDK data |
| [Apple Instruments/hitch analysis](https://developer.apple.com/videos/play/tech-talks/10855/), [OSSignposter](https://developer.apple.com/documentation/os/ossignposter) | Native render-loop/hitch investigation and custom interval markers | Native/system diagnosis and controlled captures; signposts need explicit JS/native correlation. Hook identity is app-specific |
| [OTLP](https://opentelemetry.io/docs/specs/otlp/) and [Collector processors](https://opentelemetry.io/docs/collector/components/processor/) | Language-independent signal transport and processing; tracing/metrics let apps supply manual operation telemetry | OTel alone doesn't automatically identify hook costs or validate presented frames. SDK/exporter/signal/backend support must be configured separately |
| [Sentry RN profiling](https://docs.sentry.io/platforms/react-native/profiling/) | Current beta documents Hermes JS sampling and native profiling with tracing on iOS/Android | Demonstrates that production-oriented JS/native function-level profiling already exists. Sampling is not exact invocation timing for all hooks; availability/overhead depend on SDK/platform configuration |
| [Datadog RN Mobile Vitals](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/mobile_vitals/), [advanced configuration](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/advanced_configuration/) | RUM actions/resources/views, long tasks and native responsiveness/frame/resource metrics, explicit timings/manual spans | Production RUM already correlates user journeys with performance. Vendor frame metrics/normalization are source-specific; exact all-hook execution and causal JS/native proof are not established by these pages |

Answers to the competitive questions:

- Tools can already reveal expensive functions called by hooks through JS sampling/stack profiling; React tooling also measures component/effect phases. These are different levels of granularity from explicitly identified callback-body wall timing. No audited source establishes universal exact per-hook timing across all ordinary production React builds.
- Production-oriented commercial profiling and RUM exist. Manual production spans can also measure selected hook work; feasibility/overhead must be measured. Do not pitch this as an untouched category.
- React/Chrome/RN performance tracks already correlate React work, JS tasks and user timing/network data. Native system tools can align thread activity and frames with appropriate markers. Commercial systems provide action/view-level correlation. Causal attribution remains a separate question.
- Development/profiling integrations provide richer React scheduling detail; ordinary release telemetry generally uses sampling, bounded measurements and explicit application markers. A profiling build is a special configuration, not equivalent to an uninstru­mented production baseline.
- Potential value here is reproducible open telemetry, explicit selected-hook source identity and honest completion/native evidence across runtime boundaries. Whether it improves diagnosis over the above tools requires the actual A–F experiments.

## Top five risks

1. **Measurement validity and causality:** mixed clocks, ambiguous presentation endpoints and double-counted overlapping phases produce persuasive wrong explanations. Preserve raw data, calibration and source/coverage labels.
2. **Instrumentation changes the workload:** render-time side effects, callback identities and React Compiler optimization changes; profiling/SDK overhead. Start manual, compare generated builds and measure F independently.
3. **Native observability mismatch:** Android/iOS APIs expose different frame/CPU/hitch data; JS-only probes miss independent native activity. Validate each platform, use independent system artifacts, label unavailable detail.
4. **Information loss and incomplete samples:** links/scope/integers/times lost on normalize, retries inflate samples, eviction splits traces and restart loses history. Fix fidelity/dedup/completeness/capture before interpreting results.
5. **Unvalidated RN integration and capacity:** Metro/global/context/lifecycle differences, exporter cost and unmeasured in-memory/query limits. Test pinned physical release devices, explicit async context and bounded export/cardinality under representative captures.

## Priority sequence

1. Freeze contracts and fixtures; preserve OTLP trace information and validate/deduplicate inputs.
2. Add metrics/explicit histograms, run partitions, predicates and local archive/replay.
3. Add manual interaction/hook/readiness collection; validate RN SDK bootstrap and native clock/frame sources early.
4. Extend existing timeline/inspectors, add metric overlay and minimal run comparison; generate external reproducible reports.
5. Execute repeated A–F, independent native/browser corroboration and instrumentation overhead study; defer advanced automation until those gates pass.

See [detailed tasks, acceptance and migration](IMPLEMENTATION_PLAN.md). No implementation or experimental applications were created in this task. Targeted existing tests passed: 72 Observer + 68 Observe; device/scalability/overhead claims remain untested.

## Document index

- [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md): package boundaries, diagram, receiver/storage/query/UI and test evidence.
- [OTEL_COMPATIBILITY.md](OTEL_COMPATIBILITY.md): installed versions, trace fidelity, metric/log gaps and runtime support.
- [PERFORMANCE_METRICS.md](PERFORMANCE_METRICS.md): schema/catalog, startup/hydration, distributions/cardinality/statistics.
- [REACT_HOOK_INSTRUMENTATION.md](REACT_HOOK_INSTRUMENTATION.md): hook phases, manual/Babel/DevTools/internals, compiler and overhead.
- [REACT_NATIVE_INSTRUMENTATION.md](REACT_NATIVE_INSTRUMENTATION.md): Hermes/Metro/transport/context, native APIs, clocks and adapter decision.
- [PERFORMANCE_TIMELINE.md](PERFORMANCE_TIMELINE.md): interaction model, track design, overlap/uncertainty and incremental UI changes.
- [EXPERIMENT_SUPPORT.md](EXPERIMENT_SUPPORT.md): A–F telemetry, existing/missing capabilities, risks and acceptance.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): phased tasks, complexity, package/module changes, migration/tests.
- [RESEARCH_SUMMARY.md](RESEARCH_SUMMARY.md): decisions, competitive findings and final matrix.

## Original decision matrix — 11 November 2026

Effort uses S/M/L/XL relative complexity from the plan. Native physical validation remains the highest uncertainty; estimates are not measured delivery times.

| Capability | Status at original audit | Required for talk | Effort | Original recommendation |
|---|---|---|---|---|
| OTLP Traces | HTTP JSON/protobuf/gzip implemented; incomplete fidelity/validation | Yes | L | Keep receiver; extend preservation, validation, dedup |
| OTLP Metrics | No endpoint/model/store/query/UI; SDK dependency alone | Yes | L | Add Sum/Gauge/explicit Histogram pipeline; preserve/reject other types explicitly |
| Span Events | Decoded/stored and details displayed; no timeline markers | Yes | S–M | Keep; extend precision/metadata and timestamp visualization |
| Performance Timeline | Multi-service nested waterfall, self time and inferred critical path exist | Yes | M–L | Extend tracks/events/links/clock uncertainty; retain tree viewer |
| Hook Visualization | Generic function spans/attrs possible; no hook-aware identity/phase view | Yes | M | Manual selected work, hook/source/phase rows; distinguish render data |
| RN Manual Instrumentation | Not validated; existing DOM bootstrap unsuitable | Yes | M–L | Validate upstream SDK + minimal explicit bootstrap; optional Observe entrypoint later |
| RN Automatic Instrumentation | No RN hook/native automatic instrumentor | No | XL | Defer; no private React hooks |
| Native Frame Metrics | No collection/model; generic OTLP transport reusable | Yes | XL | Validate native source/harness per OS; standard OTLP representation |
| Experiment Comparison | Span duration/version comparisons exist; no run/variant partitions | Yes | M–L | Extend predicates/capture/statistics and small UI; external report |
| Regression Detection | Version p95/error rules already implemented; no experiment-specific policy | No new system required | M–L for generalized form | Keep existing behavior; defer generalized performance CI |
