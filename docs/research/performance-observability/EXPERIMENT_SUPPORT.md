# Conference experiment support

None of A–F is complete end to end today. Current reusable foundations are OTLP/HTTP trace ingestion, events/attributes, bounded span storage, tree timeline and raw-span statistics. Observe has document/network/error instrumentation and selected function/component-call timing. Evidence: [architecture inventory and UI audit](ARCHITECTURE_AUDIT.md), especially [runtime.ts:47](../../../packages/next-observe/src/runtime.ts#L47), [receiver.ts:156](../../../packages/next-observer/src/collector/server.ts#L156), [operation.ts:55](../../../packages/next-observer/src/collector/operation.ts#L55). No applications are implemented by this research.

Implementation status (11 November 2026): the original inventory below is a research snapshot. T1–T3 capture and
T4/T5 run/comparison/timeline/metric evidence increments are now implemented; experiment C has a repeated local web
session, without full conference statistical acceptance. App-local native bootstrap now passes a Metro iOS and
restricted-JS transport preflight only. A physical iPhone is available, but RN host/Xcode/signing/Hermes validation
and iOS native evidence are still missing. See [current implementation updates](IMPLEMENTATION_PLAN.md) and
[native status](REACT_NATIVE_INSTRUMENTATION.md). None of A–F is declared conference-complete.

## Shared prerequisites and acceptance rules

Plan task IDs below refer to [implementation plan](IMPLEMENTATION_PLAN.md). Every experiment must have a reproducible run manifest, pinned artifact/tool versions, declared measurement endpoints/units, source availability, completeness/drop counts and repeated independent runs. Baseline/degraded/optimized are app variants; disabled/diagnostic/production_like are instrumentation modes, not synonyms. Separate source/OS/device/compiler/profiling-build strata. Store external artifacts by hash and preserve raw observations for an external report.

Standard OTLP traces/metrics can carry all proposed values as custom names/attributes; that is not a claim of standard React semantic conventions. Raw CPU profiles, videos, Lighthouse JSON and Perfetto/Instruments files should remain external artifacts with references rather than pretending they are OTLP spans. Native per-frame observations must not be replaced by JS rAF callbacks.

## A. Lighthouse Paradox

**Required telemetry:** pinned Lighthouse load report/score and raw metrics; controlled interaction action/handler/complete timestamps; Event Timing and lifecycle INP when available; Long Tasks/LoAF; selected render observations and hook compute spans. Maintain the distinction between an interaction sample and final page INP. Lighthouse's load score uses laboratory metrics and is not a guarantee for later interactions ([scoring documentation](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)).

**Existing:** document load and HTTP spans from Observe; manual OTel hook work would ingest and display generically. **Missing:** Lighthouse artifact association, interaction/observer collection, hook phase context, metric receiver, track projection/run comparison. **Dependencies:** T1–T5, T8/T9. Manual selected work is sufficient; native code not needed. OTLP can represent observed data; Lighthouse report remains separate.

**Risks:** unsupported Event Timing, confusing one click with INP, different load/interaction throttling, Strict Mode/profiling overhead, lab-score cherry-picking. Use current [INP reference](https://web.dev/articles/inp) to finalize the page metric, not an ad hoc max over arbitrary handler spans.

**Acceptance:** same pinned load protocol is repeated across variants, raw score distributions retained; nominated post-load interaction repeatedly exhibits a measurable difference with exact start/completion definition; main-thread/hook/render evidence is associated explicitly and caveated. If load scores are not comparable, report that result instead of forcing a paradox. Inspect raw timelines and independent browser recording for at least one representative run.

## B. Bundle Size vs Execution Cost

**Required:** artifact raw/compressed bytes, ResourceTiming transfer bytes/cache flags, selected startup JS work, blocking observations, app readiness, optional parsing/evaluation diagnostic profile. **Existing:** page/network/custom function tracing and storage. **Missing:** size/build metadata, separate transfer/execution schema, readiness markers, metrics/run queries. **Dependencies:** T1–T5, T8/T9; manual instrumentation sufficient, no native code. Bundle/transfer values use OTLP metric observations plus source artifact references.

**Risks:** same transfer size does not mean same parse/evaluation CPU; cache/compression/service worker differences; arbitrary startup elapsed interval mislabeled execution. Keep timed computation distinct from profile-confirmed execution and network wait.

**Acceptance:** predetermined size-comparability tolerance declared before collecting results, actual size/transfer distributions shown, cache/network conditions matched, and repeated startup/readiness/execution distributions reported. A failure to achieve comparable transfer sizes invalidates that comparison. No claim that bundles “weigh the same” solely from file names or one network response.

## C. Hook-Level Bottleneck

**Required:** nominated useMemo/reducer/custom-hook computation duration/count, explicit action context, Profiler committed render-work observations, completion latency and before/after distributions. **Existing:** directive whole-function spans/relative source metadata and generic waterfall; component aggregate cannot provide per-interaction render duration. **Missing:** callback-body timing/phase identity, explicit attribution, commit markers, run comparison, source-aware hook row. **Dependencies:** T1–T5, T8/T9; manual selected body instrumentation is sufficient. No native code on web; RN JS can share measurement logic after T6.

**Risks:** double-counting component/hook/Profiler work, compiler changes, useMemo registration timed instead of computation, unrelated concurrent renders, cancelled attempts. Use [hook strategy](REACT_HOOK_INSTRUMENTATION.md).

**Acceptance:** selected hook identity resolves to the intended source site; computation and result are unchanged by instrumentation; controlled degradation/optimization changes that work and repeated interaction outcomes; overlapping durations remain separate. Profiler duration is labeled render work, commitTime a marker. Source/build/compiler and timing coverage appear in the report. If total latency does not improve, report that; do not infer the optimization worked from hook duration alone.

## D. React Native Smooth FPS, Blocked JS

**Required:** native-driven animation evidence; JS timer delay, selected blocking computation/hook interval, JS handler latency and native event-to-completion where available, native frame/deadline distribution and dropped-observation counts. **Existing:** receiver can store manually produced spans; no RN collector/adapter or native frames. **Missing:** T6 bootstrap, T7 native collector/independent artifact, clock calibration, metrics and tracks. **Dependencies:** T1–T7, T8/T9. Manual JS instrumentation sufficient; native observation or external native benchmarking necessary.

**Risks:** animating on JS rather than native, JS-driven frame “monitor” freezing with JS, event-time origin mismatch, treating callback cadence as presentation. [RN performance](https://reactnative.dev/docs/performance) supplies the architectural rationale, not experimental evidence for our app.

**Acceptance:** release Hermes physical-device runs show JS scheduling lateness plus delayed JS response during independently native-driven animation; native frame source continues collecting independently during the stall; present actual deadline/jank distribution and external corroboration. Native smoothness must be supported by the selected native source, not a guessed FPS value. Android API31+ is the first validation target; iOS reports only its separately validated granularity. Show clock uncertainty and input-start availability.

## E. Native Rendering Jank

**Required:** native frame/anomaly evidence, JS responsiveness probe and selected handler work, interaction endpoints, source/deadline/refresh-rate metadata. **Existing:** generic trace display only. **Missing/dependencies:** T1–T9 as D; native measurement/harness necessary; manual JS markers sufficient. Standard OTLP can carry converted frame observations; original system traces remain artifacts.

**Risks:** the chosen native workload also blocks JS, GPU/compositor behavior invisible to selected UI source, emulator artifacts, variable refresh rate, iOS proxy overclaim. Independent system tracing is needed to validate the intended degradation mechanism, not just co-occurrence.

**Acceptance:** repeated native degradation shows changed frame/hitch evidence under matched workload while JS delay/work remains within a predeclared comparison criterion justified by baseline variance; explicit end-to-end latency measured where supported. If JS is also degraded, report a mixed bottleneck. Do not subtract stall counts from dropped frames or infer causal direction from time overlap.

## F. Instrumentation Overhead

**Required:** identical workload/artifact policy, disabled/diagnostic/production-like measurements, wall duration/startup, process/thread CPU source, memory scope, telemetry bytes/records/queues/drops, serialization/send/flush costs. **Existing:** batching and development-noise filtering; no measured overhead study or full performance schema ([Observe server batching](../../../packages/next-observe/src/server.ts#L25), [browser batching](../../../packages/next-observe/src/client.ts#L62)). **Missing:** mode controls, cost counters, bounded buffers, external measurements and run comparison. **Dependencies:** T1–T9 plus T10; native profiler/harness needed for RN CPU/memory; manual instrumentation sufficient for nominated work.

### Method

Use one workload and a predeclared build policy. Disabled must not initialize/export the telemetry under test; measure it through an independent harness. Diagnostic profiling builds incur React profiling overhead, so separate build differences from the cost of the instrumentation switches. Where possible compare identical release/profiling artifacts with runtime toggles, and add a stripped build to quantify installation/bundle/startup cost.

Counterbalance modes across repeated independent runs; fix device, foreground/cache/network/power conditions and record thermal state. Include steady-state and burst/large-trace cases. Use clock-only, aggregate-only, spans-without-export, serialization-without-network and full-export auxiliary modes to localize cost. Measure timestamp calls, context propagation and hook probes, JS/native monitoring, queueing, serialization, compression, network/retry and receiver load separately where possible. Flush after workload and measure flush separately rather than hiding cost after the stopwatch stops. Track high-water queue/memory and dropped records.

Head sampling reduces recording/export but does not eliminate already executed timing wrappers. Metrics aggregate independently of trace sampling. Slow-only/tail-selected traces are a biased latency sample; show selection rules. Tail sampling requires buffered traces and policy/trace routing, absent in current receiver; upstream [tail sampling processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md) is a future optional topology, not a feature to assume here. Adaptive thresholds must be frozen for comparison or recorded per run.

**Acceptance:** CPU/memory have validated independent sources in all modes; dropped/unsupported data is explicit; latency/startup and resource distributions plus telemetry cost are reported with counts and run-level uncertainty. Declare acceptable overhead only after measured results and product requirements; no arbitrary percentage passes this gate. Compare monitor-disabled and monitor-enabled cases to estimate probe distortion itself.

## Interpretation and report location

Use a minimal built-in comparison for navigation and median/p75/p95/count plus source/completeness. Generate statistical analysis and reproducibility report externally from versioned captures. This avoids adding a large statistics dependency to Observer for the talk, while preserving useful reusable run filtering. Report algorithm/version, run-level confidence intervals where defensible, device segmentation, predeclared exclusions, outliers and failures. Existing version-regression detection is useful product behavior, not a replacement for this experimental protocol.
