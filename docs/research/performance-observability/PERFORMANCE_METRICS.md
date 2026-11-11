# Performance measurement model

All definitions below are **proposals**, not current APIs. Current storage contains normalized spans only; existing latency histograms derive from spans ([types.ts:119](../../../packages/next-observer/src/collector/types.ts#L119), [operation.ts:55](../../../packages/next-observer/src/collector/operation.ts#L55)). Nothing here implies existing Web Vitals, hook or native-frame collection.

## Identity and schema

Experimental schema version: `observe.perf.schema_version = "1"`. Custom instruments/attributes use `observe.perf.*`; they are not official OTel conventions. Durations use seconds (`s`) in new metrics, bytes `By`, counts `{call}`, `{frame}`, `{interaction}`, `{task}` or `1` as specified. UI may display milliseconds. Existing ms-based query fields remain compatible.

Resources: `service.name`, `service.version`, appropriate `os.*`, `process.runtime.*`, device model and browser attributes where applicable. Capture actual React/RN/Hermes/browser/native build versions in the run manifest; do not invent one universal runtime resource shared by JS and native SDKs. Identify the native and JS service instances separately and relate them through a run/session attribute.

Proposed experiment attributes (custom, including the user-requested unprefixed names):

| Attribute | Location and rules |
|---|---|
| `experiment.id` | Trace/resource and run manifest; bounded project identifier; allowed metric dimension only for bounded conference captures |
| `experiment.run_id` | Trace/resource and manifest; **not metric series labels**. External run identity associates isolated metric capture partitions |
| `experiment.variant` | baseline / degraded / optimized; low-cardinality metric dimension |
| `experiment.scenario` | Allowlisted scenario name; low-cardinality |
| `experiment.platform` | web / android / ios; low-cardinality |
| `experiment.instrumentation_mode` | disabled / diagnostic / production_like; low-cardinality; disabled measurements come from external harness |
| `observe.perf.interaction.id`, `.render_attempt.id`, `.commit.id` | Trace/event only; ephemeral identifiers, never metric labels |
| `observe.perf.hook.id`, `.component.id` | Build manifest identifiers; bounded allowlist for metric labels, detailed source/build keys trace-only |
| `observe.perf.phase`, `.track`, `.measurement.source`, `.completion.kind` | Enumerated strings; distinguish source semantics and measurement scope |
| `observe.perf.clock.domain`, `.clock.offset_s`, `.clock.uncertainty_s` | Trace/resource metadata, not metric dimensions; include calibration id/validity interval in capture |

Do not set a new resource per interaction or run when sharing a long-lived process: that creates unbounded resource cardinality too. Run capture routing must partition by run without inserting unique IDs into histogram labels. For concurrent runs on one receiver, native/JS exporters attach run identity to resources/envelopes and backend partitions them before building series keys; the metric API returns run membership separately from measurement labels. Session/device serials, URLs with IDs, source paths and raw dependency values are forbidden metric dimensions.

Run manifest: experiment/run/variant/scenario/mode, app commit and artifact hashes, schema version, device class/OS/refresh rate, runtime/compiler/profiling flags, cache/start mode, seed/workload/network condition, warm-up policy, order, collection support flags, sampling policy, clock calibrations, start/end, completed/cancelled status, observed/dropped counts, external artifact references/checksums. No manifest/partition API currently exists; proposed backend work is in [plan](IMPLEMENTATION_PLAN.md).

## Collection profiles and instrument catalog

Every row inherits low-cardinality dimensions platform/variant/scenario/mode and measurement source; collection is opt-in. `H` = histogram; `C` = monotonic Counter/Sum; `G` = Gauge; `S` = interval span; `E` = timestamped span event. Histograms preserve count/sum/buckets/temporality; raw diagnostic spans retain individual observations. `W` web, `R` RN JS, `N` native. These instruments are separate measurements; never sum them into an interaction total.

| Proposed name | Signal / unit / aggregation | Additional attributes / cardinality | Collection / support / native requirement | Reliability and interpretation |
|---|---|---|---|---|
| `observe.perf.interaction.duration` | H `s`; one terminal observation + root S | action allowlist, outcome, completion.kind | W/R manual start/end; native start/presentation optional | Endpoint defines meaning; JS-handler start omits input queue delay. Timeout/cancelled results separate from successful latency |
| `observe.perf.interaction.count` | C `{interaction}`; sum | action, outcome: success/error/cancelled/timeout | W/R explicit lifecycle; no native required | Exactly once per terminal interaction; keep denominators incl. failures |
| `observe.perf.interaction.input_delay` | H `s` | event type | W Event Timing; RN native event clock → JS receipt requires N | Scheduling delay, not handler execution; missing native start means unavailable |
| `observe.perf.js.handler.duration` | H `s` + S | handler/action allowlist | W/R selected sync bodies; no native | Wall time; async handler latency is a separate interval, not CPU duration |
| `observe.perf.react.render.duration` | H `s` + diagnostic E/S | component/subtree allowlist, phase, source | W/R Profiler profiling build; no new native module | `actualDuration` is render work for a committed update, not end-start wall time; don't construct an occupied interval from it |
| `observe.perf.react.render.count` | C `{call}` | component, observed kind: attempt/commit | W/R function marker or Profiler callback | Separate render attempts from commits; abandoned work must not be relabeled committed |
| `observe.perf.react.commit.duration` | H `s` only where genuinely measured; commit marker E always possible | renderer/source | Diagnostic renderer tooling or native integration; native required for native mount timing | Public Profiler `commitTime` is a timestamp, not commit duration; unsupported source → absent value |
| `observe.perf.hook.execution.duration` | H `s` + selected S | hook.id allowlist, hook.type, phase setup/cleanup/compute/reducer/snapshot | W/R manual callback body timing; no native | Synchronous wall duration; callback invocation, not duration of registering hook; attempts can be discarded |
| `observe.perf.hook.execution.count` | C `{call}` | same bounded hook identity/phase | W/R same wrappers | No claim that one call equals a state update/commit |
| `observe.perf.state.update.count` | C `{call}` + diagnostic E | selected state/reducer site | W/R manual scheduling marker | Scheduled updates may batch/bail out; cannot attribute every later render causally |
| `observe.perf.callback.identity_change.count` | C `{call}` | bounded callback site | W/R diagnostic explicit Object.is reference check | Identity change, not execution cost; extra bookkeeping can alter workload |
| `observe.perf.js.event_loop.delay` | H `s`; sampled scheduling lateness | foreground/background, probe interval class | W/R monotonic deadline timer; no native | Timer throttling, OS scheduling and GC affect lateness; not CPU time or JS utilization |
| `observe.perf.js.long_execution.duration` | H `s` + sampled S | selected operation | W/R timed body; W long-task source is separate | Wall interval; Long Tasks don't automatically identify hook cause |
| `observe.perf.js.long_task.count` | C `{task}`; sum | source, threshold class | W PerformanceObserver Long Tasks; R only named probe-detected stalls | Unsupported browser/RN API is unavailable, not zero tasks |
| `observe.perf.web.inp` | H `s`; one final page observation | navigation type, action class if safe | W web-vitals reference algorithm; no native | Page lifecycle metric, not arbitrary interaction duration; interim updates replace prior value |
| `observe.perf.web.lcp` | H `s`; final per navigation | navigation type | W LCP observer/reference library; no native | Visibility/interaction lifecycle and caching matter |
| `observe.perf.web.cls` | H `1`; final session-window score | navigation type | W Layout Shift/reference library | Unitless score, not time; avoid accumulating each provisional update |
| `observe.perf.web.ttfb`, `.web.fcp` | H `s`; per navigation | navigation type | W Navigation/Paint Timing | TTFB is not a Core Web Vital; classify browser support/navigation lifecycle |
| `observe.perf.startup.duration` | H `s` + S milestones | startup.kind cold/warm/hot; readiness kind | W navigation anchor → app marker; RN full startup requires N | First React render, first native frame, meaningful screen and interactive readiness are distinct endpoints |
| `observe.perf.startup.phase.duration` | H `s` + S/E | phase process/bundle/hermes/first_render/first_frame/ready | R/N mixed; native needed for pre-JS phases | Only expose actual available boundaries; don't infer Hermes initialization from JS entry |
| `observe.perf.hydration.duration` | H `s` + manual S | boundary allowlist, source | W app marks around selected boundary/readiness | Elapsed marked window, not total hydration CPU; streaming/selective hydration can overlap and wait |
| `observe.perf.web.blocking.duration` | H `s` / per-window sum only over disjoint intervals | source longtask/loaf, phase | W Long Tasks/LoAF observation | Blocking definitions differ; no duplicate addition across APIs; not automatically Lighthouse TBT |
| `observe.perf.native.frame.duration` | H `s`; per-frame distribution + sampled interval | source, refresh class, screen allowlist | Android FrameMetrics/JankStats N; iOS source-specific tooling N | Android UI/CPU/overrun durations differ; iOS display-link gaps are a separate proxy, not equivalent frame completion |
| `observe.perf.native.frame.count`, `.native.frame.anomaly.count` | C `{frame}`; count and anomaly numerator | source, deadline/heuristic class | N observer/harness | Retain threshold and denominator. No universal fixed 16.7ms rule across refresh rates |
| `observe.perf.native.frame.overrun` | H `s` signed observations | source, refresh class | Android API31+ source / harness N | Negative means deadline headroom; not a nonnegative duration sum |
| `observe.perf.native.display_callback.interval` | H `s` + sampled E | refresh class | iOS CADisplayLink N | Callback cadence proxy only, cannot prove compositor presentation or absence of hitches |
| `observe.perf.native.hitch.ratio` | G `1` normalized per reporting interval, retain numerator/denominator | source, aggregation window | iOS MetricKit/XCTest N | MetricKit aggregates arrive later; don't invent per-interaction samples from a daily report |
| `observe.perf.bundle.size` | G `By`; artifact observation | compression/kind: raw/gzip/brotli | W build/harness; no native | Artifact bytes distinct from ResourceTiming transferSize |
| `observe.perf.resource.transfer.size` | H `By` or bounded run total | resource class/cache state | W ResourceTiming/harness | Cached/cross-origin restricted values need flags; zero may not mean zero work |
| `observe.perf.js.execution.duration` | H `s` + selected S | operation/phase | W/R timed workload; profiler corroboration | Selected execution wall time; total runtime CPU requires profiler/native source |
| `observe.perf.instrumentation.export.duration` | H `s` + sampled diagnostic S | stage serialize/send/queue | W/R adapter clock; no native | Network wait separate from serialization CPU; suppress tracing own exporter requests |
| `observe.perf.instrumentation.telemetry.bytes`, `.instrumentation.dropped.count` | C `By` / C `1` | signal, reason, compression | exporter/receiver/harness | Report both before/after compression, retry duplicates and drops; count boundaries explicitly |
| `observe.perf.process.cpu.time` | C `s`; delta or cumulative with start epoch | source, process role | Node process/native profiler/harness; N on RN | CPU time not event loop delay; utilization derived only with interval/core normalization |
| `observe.perf.process.memory` | G `By`; samples/max with scope | memory kind rss/js_heap/native_heap | Node/native/harness; RN N | Do not compare unlike heap/RSS definitions; browser memory APIs not universally available |

MetricKit units such as hitch milliseconds per second must be normalized/documented when mapped to ratio; retain original unit/source in raw capture. `process.*` runtime metrics can later adopt applicable pinned standard names after semantic review; the table's experimental names deliberately avoid claiming compliance with the entire process semantic convention.

## Startup, hydration and readiness definitions

Web startup uses monotonic Navigation Timing anchors: responseStart for TTFB relative to navigation start, FCP/LCP separately, application-defined `meaningful_screen` and `interactive_ready` marks. Define ready as a deterministic screen predicate, data available, and nominated controls enabled; use the same predicate across variants. Passive effects are not a global hydration completion signal. `hydrateRoot` return marks scheduling, not complete hydration; selective/Suspense boundaries need individual IDs/marks. Main-thread blocking within a hydration window is a correlated signal, not all attributable hydration CPU. TTI may be archived as a legacy lab observation; current Core Web Vitals are LCP/INP/CLS ([Web Vitals](https://web.dev/articles/vitals)).

RN startup needs native launch/process entry anchors to include process initialization, bundle loading, Hermes setup and first native frame. JS entry is only a late milestone. Separate cold/warm/hot, cached assets, navigation transitions, network readiness, meaningful screen and interactive state. Android benchmark TTID/TTFD offer useful independent endpoints ([Macrobenchmark metrics](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics)); first frame is not necessarily meaningful screen or actionable UI.

## Distribution and comparison integrity

Backend comparison keys: run partition + scenario/platform/device/build/compiler/mode/startup/network stratum + metric identity. Trace queries apply predicates to **one observation span**; avoid matching variant on one span and scenario on a different unrelated span. Resource predicates need explicit resource scope. Default comparison returns count, missing/dropped/cancelled counts, median/p75/p95, optional p90/p99, source/unit, sample policy and completeness. Empty → null/unknown. Persist raw per-run observations before eviction.

For raw samples use a declared nearest-rank rule compatible with the existing store. For histograms provide approximate quantiles with bucket bounds and algorithm; do not treat exemplars as a random population. Preserve compatible bucket boundaries/temporality; reject or explicitly downscale incompatible streams. See [OTLP limitations](OTEL_COMPATIBILITY.md#required-metric-contract).

Randomize/counterbalance variant and instrumentation mode order, repeat on the same physical device, separate warm-up and measured runs, control cache/network/thermal/power state. Report distributions and sample counts, not a single “improvement.” Bootstrap confidence intervals at the independent run/device level where justified; thousands of frames within one run are correlated samples, not thousands of independent experiments. Tail quantiles with sparse observations need a low-confidence warning, not a fabricated interval. Publish outliers with predeclared exclusions and missingness; retain failures/timeouts rather than dropping slow sessions. Existing regression thresholds are product heuristics ([regression.ts:39](../../../packages/next-observer/src/debug/regression.ts#L39)), not an experimental statistical acceptance rule.

## Reference mechanisms

Browser collection references: [INP](https://web.dev/articles/inp), [Event Timing specification](https://www.w3.org/TR/event-timing/), [LoAF specification](https://www.w3.org/TR/long-animation-frames/). Hook and platform API limitations are specified in [hook research](REACT_HOOK_INSTRUMENTATION.md) and [RN research](REACT_NATIVE_INSTRUMENTATION.md). These browser APIs need feature detection; native APIs require pinned OS/SDK availability checks. The measurement contract must emit an unsupported-source flag rather than manufactured zero values.

## Implemented per-point evidence UI — 11 November 2026

The Performance run page now expands each captured metric point into its source interval/checkpoint,
source unit, exact int64/count strings, explicit bucket counts and relative-count bars. Intervals follow OTLP's
lower-exclusive/upper-inclusive convention; no buckets are merged across points. Approximate quantiles reuse
`metric-query.ts` and display their containing-bucket bounds, with unavailable estimates for unbounded tails.
Empty, no-recorded-value and count/sum-only points remain distinct. Raw resource/scope/attributes stay inspectable.

Exemplars retain source value/time/filtered attributes and navigate by their explicit trace/span reference within
the same run. Missing/zero trace IDs have no link; trace-only references do not invent a span. Captured target spans
are selected in the run timeline; uncaptured traces and spans absent from the bounded response are explicit.
This is evidence navigation, not population reconstruction or temporal/causal metric overlay. Calibrated time-window
aggregation and aligned runtime/native panels remain proposals.
