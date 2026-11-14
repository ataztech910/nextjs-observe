# F metric delivery gate — actual reader, retry and HTTP errors

After monorepo merge #107 (`ef5b8bd`), the sibling experiment adds `/metric.html`
at local commit `4203cfa`. The monorepo branch is `step-performance-metric-delivery-notes`. Instrumentation remains in the
app/Observe layer, HTTP fault control in the external harness, ingestion/archive in the collector, and presentation
in Observer. Existing scenario-report APIs/UI are reused; the monorepo change is documentation only.

## Public boundaries and deliberately small fixture

The installed OTel JS SDK metrics 2.11 PeriodicExportingMetricReader delegates to the stock browser OTLPMetricExporter
0.222.0. Reader interval=30s, reader timeout=6s, exporter timeout=5s. An explicit initial provider.forceFlush starts
export; finish waits for it, then provider.shutdown performs a second collection/export. No natural periodic tick
or timeout/exhaustion study is claimed. No private reader/exporter queue or delegate is inspected/patched.

Eight records with values 1..8 feed one monotonic counter ({item}) and one histogram (ms), both cumulative.
Each checkpoint therefore contains counter=36 and histogram count=8/sum=36/min=1/max=8. Two checkpoints contain the
same underlying records with distinct end timestamps: **never add their counter values/counts as independent work**.

The public exporter wrapper preserves aggregation/temporality selectors and records bounded input witnesses,
entry/return/callback clocks, callback result/error, pending state and duplicate callbacks. Offline public
JsonMetricsSerializer reproduces each HTTP body exactly from the preserved fixture. This bounded projection is
not a general ResourceMetrics reconstruction API. Node transformer identity, selected upstream source and browser
build/maps are frozen. Witness projection adds work; this functional gate measures no production overhead.

The installed reader can resolve forceFlush despite a failed exporter callback. The callback error ledger remains
separate from flushError, and actual receiver/capture evidence determines delivery. A failed reader export must
not become successful delivery because a later flush/shutdown resolves. Concurrent finish callers share one promise.
Held-response verification requires initialSettled=false, phase=draining and one pending HTTP request before release;
shutdown's next export cannot precede completion of the initial export.

## Five fresh-browser functional cases

- **disabled:** no SDK initialization/imports and no OTLP. SDK export/retry/failure/timing values are unavailable;
  zero HTTP requests and received points are observed empty populations.
- **healthy:** two stock exports, both forwarded to collector.
- **retry:** first attempt of each distinct serialized body receives actual HTTP503 with Retry-After: 1, exposed
  through CORS. The unchanged exporter retries the identical bytes; the second attempt is forwarded. Four HTTP
  attempts correspond to two public exporter calls, not four SDK collections or four independent event populations.
- **rejected:** both exports receive nonretryable HTTP400; neither is forwarded. Both callbacks fail although
  reader flush resolves. Report delivery=failed; original archive remains unfinalized/incomplete.
- **held:** external receiver holds the first response until the harness verifies the finish barrier, then forwards.
  No response-delay threshold or queue-saturation/loss-rate inference is made.

Each case uses one fresh dedicated Chrome/profile/context and the same frozen build, started by a trusted
Playwright click. Fixed case order is functional validation, not a timing-distribution experiment.
Browser performance.now callback latency includes SDK/serialization/HTTP/fault/receiver/scheduling. The finish timer
starts at finish, waits for the remaining initial export and shutdown; it is not total lifetime or pure network cost.
Host monotonic HTTP receipts are separate clocks; no exact browser/host alignment is claimed.

HTTP body bytes include all attempts at the fault receiver; collector bytes include only forwarded bodies. Headers,
preflight/TLS/socket overhead are excluded. Content-Encoding is absent: browser JSON compression cost is unmeasured.
Metric queue capacity/drop counters remain explicitly unavailable rather than fabricated zero. This gate is not a
CPU/RSS overhead comparison, accepted budget, native physical gate or retry exhaustion/abort/429/full-5xx matrix.

## Commands and evidence

From the sibling `performance-observability` repository with Node 24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run metrics:gate
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:metric-delivery -- reports/<session>
```

Preserve the whole session: source/tools/lock, all HTML entries, build/maps, upstream reader/retry/fetch/exporter
source and transformer package, protocol/environment/backend identity, original SDK input/callback witnesses,
external HTTP status/attempt/Retry-After/encoding/host receipts, every actual request body, raw captured OTLP and
manifests, analysis JSON/HTML and screenshots. Replay checks all references, exact run membership, SDK/body joins,
byte-identical retries, callback drain, forwarded bytes and exact captured resource/scope/typed attributes/timestamps/
cumulative values/histogram buckets. Derived JSON must match the frozen analysis byte-for-byte.

## Final local result — 14 November 2026

Session `metric-1794646414485-258d`, Chrome 157.0.8103.78:

| Case | Delivery | Export calls | HTTP attempts | Retries | Failed exports | Received points | Wire / received B | Remaining drain + shutdown ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| disabled | passed | unavailable | 0 | unavailable | unavailable | 0 | 0 / 0 | unavailable |
| healthy | passed | 2 | 2 | 0 | 0 | 4 | 2356 / 2356 | 44.9 |
| retry | passed | 2 | 4 | 2 | 0 | 4 | 4688 / 2344 | 2041.3 |
| rejected | failed | 2 | 2 | 0 | 2 | 0 | 2362 / 0 | 5.0 |
| held | passed | 2 | 2 | 0 | 0 | 4 | 2338 / 2338 | 31.0 |

Retry gaps observed at the external receiver: 1008.742 and 1003.539 ms; callback latencies 1031.6/1026.6 ms.
These are two controlled observations, not an accepted retry/backoff distribution. Rejected flushError=null while
both callback errors remain in deliveryError. Four successful cases finalize; rejected remains unfinalized.
Observer shows passed/passed/passed/failed/passed with zero page errors; final screenshots were inspected.

82 JS + 8 Python tests and typecheck/build pass. Tests include a real upstream reader with callback failures,
held callbacks/shared shutdown, SDK-produced cumulative fixtures and a real HTTP retry/held receiver. Four mutations
are caught: erase delivery errors, remove shared finish, ignore checkpoint identity, change temporality selector.
Sources restored before final collection. Six temporary-copy corruptions are rejected: SDK witnesses/callbacks,
wire body, HTTP fault receipt, upstream retry source, archived OTLP and missing membership. Originals unchanged.
Existing A/B/CPU-source/trace-pipeline/serializer replay hashes remain identical. C regression
`cost-source-1794646429706-f2c0` passes nine fresh runs/90 actions across all three modes, including no SDK asset
loading/export in disabled. An early pilot caught a typed-attribute projection mismatch; corrected before final.
Successful development pilot remains separate from this final session.

Analysis SHA-256: `8a107742ae5ac774366d9913b231ed58fd414d22b2e03c9833a64722cfa93ae9`.
Source identity: `50ccd48ca233c8c7cd605406b60f2546a988c566a8f3fd6c859c24ad42a36a38`.
Packed Observer backend 0.3.35 reuses the installed graph via symlink, not a clean installation. No new dependency,
Observe/Observer runtime change or native build. Raw reports are ignored local artifacts; this repository has no
remote. Save the complete session alongside the local experiment commit.

Saved viewer: `http://127.0.0.1:4329/performance?report=metric-1794646414485-258d`.
Temporary collection servers close; older report viewers remain unchanged.

Next: repeated F mode/steady-burst/auxiliary/monitor-on-off studies with independent CPU/RSS and stripped-build
comparison, then overhead acceptance against explicit requirements. Compression and wider retry/timeout faults
remain unmeasured. Full F and native physical D/E/F acceptance remain open.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
