# F pipeline gate — actual SDK queue, drops and delivery

After merge #105 (`3a654df`), the separate experiment repository implements this gate at local commit `d1a0e0e`.
The monorepo change is documentation only; existing collector/storage and Observer scenario presentation are reused.

This gate validates the installed OTel JS SDK 2.11 trace BatchSpanProcessor and upstream OTLP/HTTP exporter on a
dedicated `/f.html` app entry. It uses real SDK self-observation and HTTP faults. It is a functional prerequisite
for F, not a measured overhead budget or a production loss-rate study. App instrumentation, external fault control,
collector/archive storage and Observer presentation keep their separate responsibilities.

## Sources and deliberately bounded settings

The real SDK is configured with queue capacity 16, batch size 4, exporter concurrency 16, a 30 s schedule delay,
5 s exporter timeout and 5.5 s processor timeout. These are test settings, not the defaults of the C app or a proposed
production configuration. Queue capacity excludes spans already passed to the exporter.

A real Manual MetricReader/MeterProvider receives `selfObsMeterProvider` observations from the upstream processor:
`otel.sdk.processor.span.queue.capacity`, `.queue.size` and `.processed`, including `error.type=queue_full` and export
errors. Original cumulative SDK metric snapshots are preserved before/after drain as structured artifacts. They are
not exported into the capture's metrics stream; capture metricPoints=0 is expected. No private SDK fields are read
and the processor/transport are not reimplemented. The shim's current runtime passes the self-observation option
through; the pinned underlying implementation, original build/maps and selected upstream source files are retained.

Queue high-water is **maximum observed size from two snapshots**, a lower bound in general. Saturation reaches the
configured limit 16. A separate public-exporter wrapper records each batch's span IDs, entry/return/callback times,
result/error and ordered entry/completion ledger. This ledger reconstructs exact maximum observed in-flight spans at
that boundary, distinct from buffered queue size. Duplicate callbacks, observation overflow and outstanding callbacks
cannot silently become successful results.

The wrapper delegates to the upstream exporter. Its synchronous call duration can include several kinds of work;
it is not isolated serialization. Entry→callback latency includes SDK/transport, deliberate waiting, receiver and
callback scheduling. The flush timer includes drain, self-metric collection and shutdown. These intervals overlap.
Exporter times use browser performance.now; gate receipts use external host monotonic time and SDK metrics retain
their own HRTime values. No cross-clock alignment or exact source-time attribution is claimed.

## Four actual fault cases

Each case uses a fresh Chrome process/profile/context and the same built artifact. A trusted Playwright click starts
it. There is no timing hypothesis threshold, warmup filtering or comparison of four timing distributions.

- **disabled:** no SDK initialization/imports, no produced IDs or OTLP. SDK queue/drop/flush measurements remain null
  with an unavailable reason; zero network bodies and zero produced spans are actual observed empty populations.
- **healthy:** eight ended spans, delivered through the external receiver to the packed collector.
- **overflow:** forty ended spans while the external HTTP receiver holds responses. Four enter the exporter,
  sixteen remain buffered, twenty are dropped by the real SDK. Starting drain sends the buffered spans too; the
  harness requires five pending four-span HTTP batches and a still-draining app before releasing responses.
- **rejected:** eight ended spans receive real nonretryable HTTP400 responses. Nothing is forwarded to the collector.
  SDK failed counts, exporter errors and the app delivery-error ledger must all retain this failure.

Concurrent finish callers share one operation. `forceFlush` is combined with waiting for all public exporter
callbacks before collecting final counters/shutting down. A prior in-flight batch can outlive the queue flush;
a prior completed export error can also precede a later successful queue flush. The delivery-error ledger remains
separate from the SDK flush result so a short or resolved flush never erases an earlier HTTP error.

All produced IDs reconcile with SDK dropped/failed/successful counters, exporter batch IDs, original HTTP bodies and
replayed received IDs. The receiver stores body SHA/length/IDs, status, forwarding flag and host brackets. Wire body
bytes and collector body bytes are separate; headers/preflight/TLS/socket overhead is not counted. HTTP400 is the
only rejection case here; retry/backoff/5xx and metric-exporter queues remain separate work.

Healthy/disabled captures finalize; overflow stays unfinalized/incomplete and rejection unfinalized/failed. The
external validation can pass its expected fault checks while delivery remains incomplete or failed. Observer shows
those actual delivery states. Unfinished captures remain unfinished archives, not immutable finalized datasets.

## Commands and preserved evidence

From the sibling `performance-observability` repository with Node 24 and installed Chrome:

```sh
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run pipeline:gate
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:pipeline -- reports/<session>
```

Each session preserves source/lock/tools, all app entries, frozen build/maps, selected upstream source files,
protocol/settings/environment/analysis/backend identity, original SDK metric snapshots, exporter call/error ledgers,
external HTTP receipts and bodies, raw OTLP, analysis JSON/HTML and screenshots. Replay checks hashes, schedule,
source/build association, metric units/cumulative semantics, conservation, event order, public callback completion,
wire/receiver identities and manifest state. Analysis must match its frozen JSON byte-for-byte.

Existing A/B/source-gate analysis algorithms are unchanged; future source inventories additionally include f.html.
The experiment's noEmit TypeScript configuration permits .ts imports so the same pure tracker is tested directly
with Node type stripping. No new npm dependency, SDK private patch, Observe/Observer runtime change or native build
is required. This repo has no remote; original reports are ignored local artifacts. Preserve the full session.

## Final local result — 14 November 2026

Session `pipeline-1794641370737-5d72`, Chrome 157.0.8103.78:

| Case | Delivery | Produced | Queue before / capacity | Dropped | Export failed | Received | Wire / received body B | Drain/collection/shutdown ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| disabled | passed | 0 | unavailable | unavailable | unavailable | 0 | 0 / 0 | unavailable |
| healthy | passed | 8 | 4 / 16 | 0 | 0 | 8 | 4536 / 4536 | 50.1 |
| overflow | incomplete | 40 | 16 / 16 | 20 | 0 | 20 | 11375 / 11375 | 100.4 |
| rejected | failed | 8 | 4 / 16 | 0 | 8 | 0 | 4546 / 0 | 1.5 |

All final enabled queue snapshots are zero; maximum in-flight spans are 8/20/4. Synchronous exporter calls range
0.1–1.9 ms; callback latencies healthy 48.0–85.1, overflow 43.4–98.6, rejected 6.9–11.8 ms. These include deliberate
fault control and local receiver work and are not production/exporter cost estimates. Rejected errors had already
completed before final drain: SDK flushError=null but deliveryError retains both actual HTTP400 failures.

71 JS and 8 Python tests pass; typecheck/build pass. Four mutations caught: remove callback barrier, change queue
capacity without adjusting protocol, force incomplete delivery to passed, and ignore queue_full drops. Sources were
restored before collection. Six temporary-copy corruption checks reject SDK/exporter samples, raw wire body, HTTP
fault receipt, upstream SDK source, archived OTLP and missing membership. Original A/B/CPU-source analysis hashes
remain unchanged. C regression `web-scenario-1794641490889-dc8afa` passes on the same new shared build.

The packed Observer reader validates and displays passed/passed/incomplete/failed with zero page errors; final
analysis and Observer screenshots were inspected. SDK-disabled timing remains unavailable. One early pilot rejected
manifest property-order differences; deep comparison fixed it. Successful development captures remain separate;
the final run also removes a disabled flush placeholder instead of presenting it as a measured zero.

Analysis SHA-256: `4d1d9702c4e7a11fce895119156a4853d46748d0d31e1f9c80821f2e8dfa18a9`.
Source identity: `0b0fee31ff65089cf1b224a02a6941e7a82a0876aa0a1584aa30c9962e85a0a8`.

Saved report: run the separate collector with CAPTURE_DIR/ PERFORMANCE_REPORT_DIR pointing to this session and open
`/performance?report=pipeline-1794641370737-5d72`. Current local viewer is on port 4327.

Next: isolate serialization/export phases where supported, validate metric-exporter/retry/queue costs, then perform
repeated mode/auxiliary/monitor-on-off and stripped-build comparisons with independent CPU/RSS. Full F, native
physical presentation and D/E/F device acceptance remain open.

References: [OTel batching processor specification](https://opentelemetry.io/docs/specs/otel/trace/sdk/#batching-processor),
[SDK self-observation metric conventions](https://opentelemetry.io/docs/specs/semconv/otel/sdk-metrics/).
Installed SDK source/build evidence determines this gate's actual implementation behavior.

Local viewer: `http://127.0.0.1:4327/performance?report=pipeline-1794641370737-5d72`.
Temporary browser/preview/fault-control processes close after collection; earlier viewers remain unchanged.
Packed backend 0.3.35 reuses the installed dependency graph via symlink, not a clean installation. Experiment code
and ignored raw reports remain local because that repository has no remote. The AI review hook reported
unavailable/timeout and continued fail-open itself; hooks were not bypassed.
