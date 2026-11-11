# OpenTelemetry compatibility

Status as audited 2026-11-11. Repository evidence is relative to the root identified in [architecture audit](ARCHITECTURE_AUDIT.md). Supported means implemented by this checkout, not merely available in an installed SDK.

## Versions

Read both package-lock.json and installed node_modules package.json. They agree for the following relevant packages:

| Package | Installed / locked | Role |
|---|---|---|
| OTel API | 1.9.1 | Observe peer API; backend test tools |
| sdk-trace-base / sdk-trace-web / resources | 2.11.0 | Observe providers/processors/resources; web SDK absent in backend |
| exporter-trace-otlp-http / instrumentation | 0.222.0 | Observe JSON HTTP export and instrumentation |
| document-load instrumentation | 0.67.0 | DOM auto-instrumentation |
| sdk-metrics | 2.11.0 | Installed dependency; no configured Observe metric pipeline |
| sdk-logs / api-logs | 0.222.0 | Installed dependencies; no configured Observe log pipeline |
| @vercel/otel | 2.1.3 | Server/Edge bootstrap and JSON/protobuf exporters |
| semantic-conventions | 1.43.0 | Observe constants; online conventions were observed at 1.45.0 |
| React / TypeScript / Vitest | 19.3.0 / 7.0.2 / 5.0.3 | Local application/tooling versions, not RN version claims |

Sources: [Observe lock](../../../packages/next-observe/package-lock.json), [backend lock](../../../packages/next-observer/package-lock.json), [UI lock](../../../packages/next-observer/ui/package-lock.json), corresponding manifests. Receiver uses its own decoder and Node built-ins, not an OTel receiver SDK ([server.ts:19](../../../packages/next-observer/src/collector/server.ts#L19)).

Current official reference is [OTLP specification](https://opentelemetry.io/docs/specs/otlp/), observed as 1.11.1. It describes HTTP protobuf/JSON and gRPC, per-signal endpoints, matching success-response encoding, and retry/partial-success contracts. This checkout implements a subset; the version installed in an exporter does not establish receiver conformance.

## Traces: wire and information fidelity

| Feature | Current receiver status | Evidence / required action |
|---|---|---|
| OTLP/HTTP POST `/v1/traces` | Implemented | [server.ts:156–189](../../../packages/next-observer/src/collector/server.ts#L156) |
| JSON | Implemented, partial schema handling | JSON.parse → decodeOtlpJson; unknown fields ignored |
| Protobuf | Implemented custom subset | [protobuf.ts:138–183](../../../packages/next-observer/src/collector/protobuf.ts#L138); unknown fields skipped |
| gzip | Implemented; 10 MiB before/after expansion | Same ingest handler; synchronous decompression |
| gRPC / profiles | Not implemented | Only Node HTTP routing in [server.ts:315](../../../packages/next-observer/src/collector/server.ts#L315) |
| traceId / spanId / parentSpanId | Preserved; protobuf bytes → hex | [decode.ts:69](../../../packages/next-observer/src/collector/decode.ts#L69), [protobuf.ts:141](../../../packages/next-observer/src/collector/protobuf.ts#L141). No complete ID validation/canonicalization |
| Span events | Name/time/attributes preserved | [decode.ts:84](../../../packages/next-observer/src/collector/decode.ts#L84); dropped-event counts lost |
| Span links | **Lost** | No link branch in protobuf reader or NormalizedSpan field |
| Span/resource attributes | Common value structures preserved with type/precision caveats | [decode.ts:40](../../../packages/next-observer/src/collector/decode.ts#L40). int64 → Number may round; bytes not tagged; duplicate keys collapse |
| Instrumentation scope | Name only | [decode.ts:77](../../../packages/next-observer/src/collector/decode.ts#L77); version, attributes, dropped count and schema URL discarded |
| Status, kind | Known numeric enums mapped, message retained | [decode.ts:74–81](../../../packages/next-observer/src/collector/decode.ts#L74); unknown enums collapse to defaults |
| Timestamps | Nanosecond input accepted, not preserved exactly | Start/events floor to microseconds then Number epoch-ms; duration subtraction uses BigInt before conversion, [decode.ts:56](../../../packages/next-observer/src/collector/decode.ts#L56) |
| TraceState / flags / remote context | Not retained | [types.ts:14](../../../packages/next-observer/src/collector/types.ts#L14) |
| Resource/scope schema URLs, dropped counts | Not retained | Decoder schema and custom protobuf branches |

Simple cross-service parent trees can be reconstructed if producers propagate valid context. Complex fan-in/shared work requiring links cannot be reconstructed faithfully today. Exact nanosecond ordering also cannot be recovered after normalization. Retaining an original typed OTLP envelope alongside the existing normalized UI projection is the least disruptive design; preserve int64/nanoseconds as decimal strings at JSON boundaries and bytes in canonical base64. Extend projection additively with optional links and metadata; retain existing ms fields for API compatibility. Archive format needs its own version, not an implicit reinterpretation of old normalized spans.

## Limits, errors, and conformance gaps

Receiver defaults: loopback port 4318, optional x-api-key ingestion auth, separate UI Basic auth; CORS allows content-type/content-encoding/x-api-key. Unsupported type/encoding →415; auth failure →401; size →413; malformed JSON/protobuf/gzip parsing →400; protobuf success empty binary body, JSON success `{}` ([server.ts:96–189](../../../packages/next-observer/src/collector/server.ts#L96)).

Structural JSON and semantic validation are incomplete: normalization happens outside the parse catch, so malformed timestamps/shapes can produce 500, and unrelated `{}` can produce success with zero spans. Errors are generic JSON, not a complete OTLP Status/partialSuccess implementation. No per-span partial rejection, deduplication, per-request span count/attribute depth limit or backpressure admission policy is visible in this handler. These are audit findings, not tested exploit claims. Add fixtures for malformed IDs, zero IDs, invalid times, nesting and retry behavior before calling the receiver conformant. Protobuf `skip` compatibility tests prove tolerance of unknown wire fields, not preservation of those fields ([collector-protobuf.test.ts:72](../../../packages/next-observer/test/collector-protobuf.test.ts#L72)).

## Metrics: currently absent end to end

POST `/v1/metrics` returns 404 under the actual routing; `StorageAdapter` only contains span operations ([server.ts:319–328](../../../packages/next-observer/src/collector/server.ts#L319), [types.ts:119](../../../packages/next-observer/src/collector/types.ts#L119)). There is no MeterProvider/reader/metric exporter configured by Observe ([client.ts:57](../../../packages/next-observe/src/client.ts#L57), [server.ts:66](../../../packages/next-observe/src/server.ts#L66)).

| Requested capability | Observe setup | Receiver / storage / query / UI |
|---|---|---|
| Counter / UpDownCounter | SDK dependency available, not wired | Unsupported |
| Gauge | SDK dependency available, not wired | Unsupported |
| Histogram | SDK dependency available, not wired | Unsupported |
| ExponentialHistogram | Requires SDK aggregation/export configuration | Unsupported |
| Sum / monotonicity | Not exported here | Unsupported |
| Delta / cumulative temporality | Not configured here | Unsupported |
| Exemplars / resource and point attributes | Not exported here | Unsupported |

`latencyHistogram()` bins raw span durations and computes nearest-rank sample p50/p95/p99; it is not OTLP Histogram ingest ([operation.ts:55](../../../packages/next-observer/src/collector/operation.ts#L55), [memory-storage.ts:20](../../../packages/next-observer/src/collector/memory-storage.ts#L20)). p75/p90 are not exposed today.

### Required metric contract

Based on the [OTel metric model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/) and [metrics protobuf](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/metrics/v1/metrics.proto): preserve resource/scope identity, metric name/unit/description, point attributes, exact interval timestamps, flags, integer/double representation; for sums preserve monotonicity and temporality. Histograms retain count/sum/optional min/max, all bounds/counts, exemplars. Exponential histograms retain scale, positive/negative bucket offsets/counts, zero count/threshold. A Counter/UpDownCounter API instrument maps to a Sum stream; these are not separate wire point types.

Keep cumulative points as checkpoints; never sum successive cumulative snapshots. Derive deltas only within one stream/start epoch, handling reset/gaps and duplicate/reordered points. Sum compatible disjoint deltas; never average p95 values. Explicit-bucket quantiles locate a bucket and give bounds, or a documented interpolation estimate: values within the bucket are unknown, and open-ended buckets have no finite upper error bound. Exponential buckets offer relative resolution controlled by scale; downscaling/merging loses detail and cannot recover exact observations. p50/p75/p90/p95/p99 are exact sample estimators only when computed from complete raw observations under a declared quantile rule. Unknown/censored/empty series must not return a misleading zero latency.

For MVP implement Sum, Gauge, explicit Histogram in both HTTP encodings; preserve ExponentialHistogram envelopes but expose “preserved, analysis unavailable” until its merge/quantile logic is verified. Do not silently accept then discard an unsupported point type. Metrics are required for the complete conference scope; a trace-only proof can precede this milestone but is not final readiness.

## Logs and diagnostic representation

No `/v1/logs`, log model, query or log viewer exists in the route/type contracts above. Installed log SDKs do not change that. Browser `console.error` capture is implemented as **error spans** ([browser-errors.ts](../../../packages/next-observe/src/browser-errors.ts)), not OTLP logs.

Recommended representation: bounded hook executions as spans plus aggregated duration/count metrics; slow-hook threshold notification as a span event. JS scheduling stalls and frame anomalies as histogram/counter observations plus sampled independent diagnostic spans, linked to known interactions. Events are suitable when they belong to an existing span and need timestamp/detail but not an independent interval. Detached diagnostics may later use OTLP logs, especially standard application events; logs are not conference critical. Do not encode every frame or hook as a log solely to avoid adding metrics.

## SDK, propagation and cross-runtime use

Browser registration calls provider.register() with defaults. The installed `sdk-trace-web` 2.11.0 implementation selects StackContextManager and W3C trace/baggage propagators (`node_modules/@opentelemetry/sdk-trace-web/build/src/WebTracerProvider.js:12–65`). StackContextManager restores context when a synchronous callback returns; it does not preserve it across arbitrary awaits. Ending an async span correctly in `__observe.run` does not prove its descendants inherit it. Explicit contexts at async boundaries are required for the MVP. Cross-origin trace headers and backend extraction must also be configured/tested; same-origin Next forwarding is not proof of every network topology.

Current upstream [OTel JS runtime guidance](https://github.com/open-telemetry/opentelemetry-js#supported-runtimes) explicitly describes RN/Expo using browser implementations with Metro >=0.81.3 (RN >=0.79, or updated Metro on 0.76–0.78). That is evidence for testing upstream reuse, not evidence that this project's DOM bootstrap works in Hermes. Installed HTTP transport uses global fetch (`@opentelemetry/otlp-exporter-base/build/src/transport/fetch-transport.js:48–75`); core browser code references performance. Device validation must verify conditional resolution, clocks/timeOrigin, randomness, timers, AbortController/fetch keepalive behavior and lifecycle flushing. No async-hooks context manager should be imported into RN. See [RN adapter decision](REACT_NATIVE_INSTRUMENTATION.md).

Node/PHP/Go/native OTel producers can target this receiver using supported HTTP encodings; they need no Observe package. This is an interoperability design supported by the language-neutral decoder, not a claim of tested ingestion from those SDKs. Add real exporter fixtures before advertising compatibility.

## Conventions

Use existing standard HTTP semantics for network work ([HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)), standard service identity and appropriate OS/runtime/device resource attributes. Browser resources have developing conventions ([browser resources](https://opentelemetry.io/docs/specs/semconv/resource/browser/)); do not attach browser.* to RN just because it uses an SDK browser implementation.

Current [application events](https://opentelemetry.io/docs/specs/semconv/app/app-events/) include developing click, crash and `app.jank` events. They do not provide a stable generic React hook/interaction completion schema. Observe's `observe.kind`, `react.render.*`, `code.function` and `code.filepath` are current emitted fields, not a claim of modern semantic-convention compliance. New performance names in [measurement model](PERFORMANCE_METRICS.md) are explicitly experimental `observe.perf.*`. Pin convention/schema versions; avoid silently replacing existing API fields or mapping an experimental span event to a standard log event without documenting the signal difference.
