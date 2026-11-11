# React Native instrumentation research

## Decision

Do not create a dedicated RN instrumentation package for the conference now. Reuse upstream OTel API/SDK primitives and selected manual instrumentation; design a **minimal explicit RN bootstrap/adapter**, initially app-local in the separately developed experiment app. If reusable distribution is justified after device validation, add an optional `next-observe/react-native` subpath rather than a new SDK. Native frame/startup collection still needs native code or external native benchmark artifacts. A JS-only package cannot supply those measurements.

Implementation update (11 November 2026): the separate `performance-observability` experiment repo now has an app-local
`native/bootstrap.js`, runtime-port probe, serialized lifecycle/flush/shutdown helper and Metro iOS preflight. It uses
the real Observe performance entry and pinned OTel SDK/exporters, without changing Observer or adding a native SDK
package. Metro 0.88 / RN Babel transformer 0.88 resolve the tested graph; a restricted Node VM exports to the packed
Observer and verifies explicit async parentage/errors/events/modes/failure cleanup. This is **not** an RN host app,
Hermes test, physical-device validation or native measurement source. Native frames/input/clocks/drop counts remain
unavailable or unverified. The original [audit](ARCHITECTURE_AUDIT.md#package-inventory) describes the earlier snapshot.

Follow-up (12 November 2026): the experiment repo now contains an official-template RN 0.88.0 / React 19.3.0
`native/host` iOS app with AppRegistry, runtime/capture-gate screen and AppState lifecycle wiring. Xcode 26.3,
repo-local CocoaPods dependencies (86 pods) and committed Ruby/pod locks produce a native Release Simulator build.
The user selected Simulator: iPhone 17 Pro / runtime-reported iOS 26.3.1 detects Hermes, exposes every required port
without added polyfills and finalizes disabled / diagnostic / production_like captures with 0/4/2 spans and 0/4/4
metric points. Packed Observer displays the actual captures, explicit parents/events and source/build metadata.

Source manifests pin JS/native configuration, npm/Ruby/pod locks and the actual Observe helper. Xcode prepares the
identity before bundling; the smoke preserves its artifact body and native executable/embedded bundle hashes.
Host Metro is RN's selected 0.87.3; standalone restricted-VM preflight remains 0.88.0 with separate receipts. Model
captures carry `restricted-js-host-model`; actual Simulator captures record `react-native-js` and `isSimulator:true`.

Xcode was installed by the user. Keg-only Ruby 3.3 was installed for repo-local Bundler/CocoaPods after system
Ruby 2.6 failed against the SDK; the system Ruby/default PATH were not replaced. No device signing/account was
configured. Physical iPhone execution, calibrated clocks, native input/frames, queue-drop accounting and iOS
cadence/hitch evidence remain open. Android SDK/JDK are absent. See experiment `native/host/README.md` for the
repeatable Simulator command and separate future physical-device gate. Simulator functional success is not D/E/F
conference acceptance or evidence of physical-device performance.

## Reuse and package boundaries

| Existing surface | Reuse judgment | Evidence |
|---|---|---|
| `next-observe/performance` manual helper | App-local transport/context checks pass in actual Release iOS Simulator/Hermes and the separate Metro preflight. Physical iPhone support remains unverified | `packages/next-observe/src/performance.ts`; separate experiment `native/bootstrap.js` |
| OTel API + selected ordinary function spans | Reusable concept; validate Hermes/runtime | [runtime.ts:47–80](../../../packages/next-observe/src/runtime.ts#L47) only imports OTel API, handles exceptions/thenables; no RN device validation |
| Existing component path | Unsuitable as RN render support | `isBrowser = typeof window !== 'undefined'`; environment heuristic may select different behavior in RN globals; browser branch is an aggregate rather than renderer integration ([runtime.ts:7](../../../packages/next-observe/src/runtime.ts#L7)) |
| `next-observe/client` | Cannot use unchanged | document-load/DOM, window/document visibility lifecycle, Response/error capture, build-inlined process.env; top-level auto-registration ([client.ts:27–82](../../../packages/next-observe/src/client.ts#L27)) |
| `next-observe/server` | Do not use for RN bootstrap | @vercel/otel, process.env, server/Edge lifecycle, crypto.randomUUID instance id ([server.ts:1–19](../../../packages/next-observe/src/server.ts#L1)) |
| `/config`, `/loader`, `/proxy` | Next/build-specific setup | Node fs/path and Next config, CJS loader, Next route/proxy assumptions ([config.ts:1](../../../packages/next-observe/src/config.ts#L1), [loader.cts:9](../../../packages/next-observe/src/transform/loader.cts#L9), [proxy.ts:11](../../../packages/next-observe/src/proxy.ts#L11)) |
| Babel plugin internals | Potential future reuse | Generic Babel transform exists but exported loader integration is Next-specific; not an RN automatic hook instrumentor ([plugin.ts](../../../packages/next-observe/src/transform/plugin.ts)) |
| Receiver/backend/UI | Reusable OTLP destination | No RN SDK dependency required; supported HTTP encodings and generic span data ([server.ts:156](../../../packages/next-observer/src/collector/server.ts#L156), [decode.ts:59](../../../packages/next-observer/src/collector/decode.ts#L59)) |

Upstream [OTel JS runtime documentation](https://github.com/open-telemetry/opentelemetry-js#supported-runtimes) now describes RN/Expo browser implementations and minimum Metro resolution support. Use its version conditions as a starting gate, not proof that every browser instrumentation works. Pin the RN/Hermes/Metro versions in the future experiment spec.

## Adapter feasibility checklist

The adapter would receive endpoint, resource identity, run capture identity, clock/lifecycle ports and mode explicitly; it must not import Observer or Next configuration.

| Area | Required validation before adopting |
|---|---|
| Metro packaging | Resolve installed SDK 2.11.0 / exporter 0.222.0 conditional exports/imports; ensure Node modules don't leak into Hermes bundle. Existing `next` peer dependency is a packaging concern if distributing within Observe |
| Globals / clocks | Test performance.now/timeOrigin/Date conversion on pinned RN version; feature detect supported PerformanceObserver entries. [RN performance docs](https://reactnative.dev/docs/global-performance) do not imply browser Event Timing/LoAF/native frame support |
| Export transport | Installed browser delegate uses global fetch, URL, abort and response methods (`node_modules/@opentelemetry/otlp-exporter-base/build/src/transport/fetch-transport.js`). Test real device networking, timeout, auth, endpoint, payload encoding, retry/suppression; no DOM/sendBeacon requirement should be assumed from old guidance |
| Context | Use explicit parent Context for async callbacks/promises/native boundaries. Default web StackContextManager only tracks synchronous activation; no Node async_hooks or unverified zone patching |
| IDs / crypto | Verify ID-generator implementation selected by Metro and its runtime globals; do not assume Node crypto, global crypto.randomUUID or Buffer exists. Distinguish trace ID generator requirements from server.ts instance UUID |
| Timers / lifecycle | Bounded batch queue; flush on deliberate end-of-run and RN AppState changes where possible. Suspension/termination can lose telemetry; periodic sending and native buffering may be needed |
| Initialization | One explicit provider per runtime; teardown/shutdown for tests/reload; no import-time auto-registration or global window heuristic |
| SDK metrics | sdk-metrics dependency exists but needs reader/exporter setup; test metric temporality/points after receiver support. Importing SDK is not end-to-end support |

Success gate: release Hermes build on physical Android and iOS sends manual parent/child/error/events and linked work, survives awaited/concurrent callbacks without context leakage, flushes bounded telemetry without recursion, and reports drops. Full native packages are not needed to run this gate; real-device builds are needed to establish results.

## JS thread measurements

Measure expected timer deadline versus actual monotonic callback time. Record `max(0, actual−expected)` and reset scheduling policy after each observation. Do not emit a burst of fake “missed ticks” after a stall. Record probe interval, lifecycle/background state and availability. Event-loop delay includes scheduling, garbage collection, OS pauses and timer policies; it is not CPU consumption or a continuous JS utilization percentage. Long synchronous selected bodies have wall-clock execution measurements; JS CPU time needs a validated sampling/thread CPU source. Awaited network duration is neither JS execution nor CPU.

Handler entry/exit markers omit time between physical touch and JS entry unless a native event timestamp can be mapped. Use explicit interaction start/complete tokens. Render observations follow the limitations in [hook research](REACT_HOOK_INSTRUMENTATION.md). [RN performance guidance](https://reactnative.dev/docs/performance) describes native-driven animations/scrolling continuing while JS is blocked; therefore smooth UI frames cannot establish JS responsiveness, and JS stalls cannot establish native jank.

Modern [New Architecture](https://reactnative.dev/architecture/landing-page) uses JSI/Fabric/TurboModules. Native collection should use supported native APIs and a small typed boundary; do not reason from a legacy serialized bridge. Synchronous JSI calls can still block the caller. Avoid a per-frame native-to-JS callback stream: aggregate natively, buffer compact diagnostic intervals and export/batch independently so blocked JS cannot erase evidence of native smoothness.

## Native API selection

| API / platform | Best use | Data / availability / limitations |
|---|---|---|
| Android [JankStats](https://developer.android.com/topic/performance/jankstats) | In-app production-like observation, controlled diagnostics | AndroidX; estimates API16+, stronger FrameMetrics-based timing API24+, API31 richer deadline data. Per-frame state/heuristic jank; callbacks must remain short and reused frame objects copied immediately. Pin library/OS and heuristic |
| Android [FrameMetrics](https://developer.android.com/reference/android/view/FrameMetrics) | Window/native instrumentation | API24+ frame duration phases; newer fields differ by API. UI/CPU/draw timing is not necessarily display presentation; handle dropped callback reports |
| Android [FrameTimeline / Perfetto](https://perfetto.dev/docs/data-sources/frametimeline) | Controlled system tracing / presentation validation | Android12+ expected/actual timeline and compositor-related evidence; more precise frame diagnosis. Not a generic JS runtime API or effortless always-on upload stream |
| Android [Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics) | Repeatable startup/frame experiments | Independent release/profileable app testing, startup/frame metrics and system artifacts; build/test orchestration required |
| [Android Vitals](https://developer.android.com/topic/performance/vitals) | Fleet production aggregates | Play distribution/reporting constraints, delayed aggregates; useful external baseline, not a per-interaction local collector |
| iOS [CADisplayLink](https://developer.apple.com/documentation/quartzcore/cadisplaylink) | In-app callback cadence proxy | Native callback synchronized to display refresh, timestamp/targetTimestamp; run-loop mode, refresh rate and scheduling affect observations. Does not certify every rendered frame was presented |
| iOS [MetricKit](https://developer.apple.com/documentation/metrickit) | Production system aggregates/diagnostics | Framework available on supported Apple OS; metric reports describe preceding 24h and arrive at most daily; diagnostics have different delivery rules. Not the primary live frame track |
| iOS Instruments / [animation hitch diagnostics](https://developer.apple.com/videos/play/tech-talks/10855/) | Controlled render-loop/hitch analysis | Native system-level validation; capture/import separate from app telemetry; stronger evidence than display-link callbacks |
| iOS [XCTest hitch metrics](https://developer.apple.com/videos/play/wwdc2020/10077/) | Repeatable benchmark | Aggregate animation/hitch measurements over a declared interaction; cannot fabricate individual frame intervals from an aggregate |
| iOS [OSSignposter](https://developer.apple.com/documentation/os/ossignposter) / os_signpost | Native markers correlated in Instruments | Native interval/event correlation; requires capture/export mapping to OTel; a signpost marker is not presentation evidence |

MVP platform choice: validate Android API31+ first for D/E because deadline/system-frame evidence is more directly available. Validate iOS independently using Instruments/XCTest; label CADisplayLink telemetry as cadence only. If iOS per-frame presentation mapping is unavailable, show its validated aggregate hitch evidence and explicit limitation rather than claim identical Android/iOS resolution. Native hooks for startup phases and Fabric internals are not implied by JankStats.

[Fabric render/commit/mount description](https://reactnative.dev/architecture/render-pipeline) separates JS element/shadow work, commit/layout and mounting host views. React public commit markers alone do not identify all Fabric phases or visible presentation. Exact internal phase tracing is optional diagnostic work, version-coupled and not an MVP dependency.

## Clock synchronization and trace context

OTLP timestamps need epoch nanoseconds; interval measurement must use a monotonic clock. Calibrate JS and native domains at startup and around capture boundaries. For a ping-pong sample JS monotonic `j0`, native monotonic `n`, return `j1`: estimate offset `n−(j0+j1)/2`, with at least half round-trip uncertainty plus clock precision/scheduling/asymmetry. Repeat, prefer low-round-trip samples and record the model/validity interval; do not present the estimate as exact. Detect drift, background/resume, wall-clock changes and invalid calibration. Mapping each domain to an epoch anchor is separate from comparing same-domain durations.

A native input recorded long before blocked JS receives it retains its original native timestamp and conversion uncertainty. Batch delivery time is not event time. Never shift events to make spans fit a desired hierarchy. Keep raw native monotonic stamps and calibration ids in capture metadata; map times for visualization while preserving originals.

Pass serialized W3C trace context or explicit trace/span ids plus flags/state through a typed TurboModule/JSI boundary. Extract into the native SDK before starting child operations; return context when needed. Cross-runtime parent-child is appropriate when one operation initiates a child and ownership is known even if clocks differ. Shared/background/native frame work may serve multiple interactions; use span links and correlation keys, not arbitrary parenting to the latest interaction. A frame can be merely temporally adjacent; show that relationship as correlation, not causation. T1 now preserves source links in the receiver projection and T3 archives raw requests. Native clock/context mapping and physical validation remain prerequisites; see [implementation status](IMPLEMENTATION_PLAN.md).

## Three options

1. Reuse existing package **unchanged**: smallest nominal work, but DOM/Next bootstrap and environment heuristic make this unsuitable for reliable RN collection.
2. Minimal adapter around upstream SDK plus selected Observe-compatible measurements: recommended. Own explicit bootstrapping, clock/run identity, bounded exporting and native integration ports; preserve current Observe APIs.
3. Dedicated RN instrumentation package: consider only when adapter validation demonstrates distinct native build/distribution/versioning needs across multiple apps. Adds RN peers, pod/Gradle/codegen maintenance and platform test matrix; unnecessary for initial manual JS spans.

No instrumentation belongs in Observer. Backend changes are generic OTLP preservation, metric points and query/correlation. Native benchmark import can be an external conversion tool that emits standard OTLP and a versioned artifact manifest.
