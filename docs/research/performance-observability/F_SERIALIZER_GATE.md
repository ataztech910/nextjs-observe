# F auxiliary gate: serializer-only and stock export

After monorepo merge #106 (`0c93c14`), the sibling experiment repository adds `/serialize.html`
at local commit `c6494a3`. This monorepo branch is `step-performance-serializer-notes`.
Observe/app instrumentation, external harness, collector/archive storage and Observer presentation remain separate.
The monorepo needs documentation only; its existing typed scenario reader displays these measurements.

## What is measured

Four matched blocks alternate compact/large profile position, eight fresh dedicated Chrome processes in total.
Compact holds 8 ended SDK root spans with a short UTF-8 payload; large holds 128 with a larger payload. A bounded
public SpanProcessor holds the ended input batch. These fixture spans describe input creation, **not** the
serialization/export measurement intervals. No metric exporter or BatchSpanProcessor is exercised in this entry.

The app calls public `JsonTraceSerializer.serializeRequest` exactly 20 times per page, recording each
performance.now bracket, including the first call and all quantized/zero durations. The bracket covers SDK
projection, JSON stringify and UTF-8 encoding. Stability comparisons and output copies happen outside the timed
call; witness projection, base64, hashing/downloads and shutdown are outside the selected phase brackets.
Twenty calls on one page are repeated observations, not twenty independent runs. There are four independent runs
per profile; no warmup removal, confidence interval or performance acceptance threshold is applied.

Then the unmodified stock OTLPTraceExporter exports the **same ended SDK batch** once. Its public wrapper records
entry/return/callback; the external HTTP receiver forwards the unchanged body to the packed collector. Auxiliary
bytes, stock HTTP bytes and offline upstream serialization of the preserved input must match exactly. Offline
projection deliberately supports only this bounded ended-root-span/no-links/no-tracestate fixture, not arbitrary
ReadableSpan reconstruction. Frozen upstream source identity and build/maps associate the implementations.

Stock callback latency includes its own serialization, SDK/HTTP/receiver work and callback scheduling. It is
**not pure network time**; subtracting the auxiliary serializer duration does not isolate transport. Fixed phase
order warms the same data/code before export. This is an auxiliary decomposition experiment, not a pristine
primary exporter benchmark or full F overhead study. No private exporter/delegate is patched or replaced; no
extra serializer call is inserted inside the stock exporter call.

External browser CDP process CPU plus macOS ps CPU/RSS snapshots bracket each whole phase independently. A separate
SDK-free busy/retained-64MiB calibration must pass first. Scope is all renderer processes/threads in one dedicated
Chrome, including spares; browser/GPU/collector/harness are excluded. Phase CPU includes automation, byte checks and
snapshot acquisition effects, so it is not per-call serializer CPU. Endpoint summed RSS can double-count shared
pages; it is not private heap, allocation volume, peak memory or evidence of a leak. Clocks are not cross-aligned.
The serializer phase contains 20 calls while export contains one; their CPU totals are not an overhead ratio.

One pinned experimental public package, `@opentelemetry/otlp-transformer@0.222.0`, is now a direct experiment
dependency. It was already installed transitively: offline lock update changed only the root dependency record.
No fresh dependency graph/native build or Observe/Observer runtime change is involved.

## Run and replay

From the sibling `performance-observability` repository with Node 24, installed Chrome and the packed backend:

```sh
npm test
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run serializer:gate
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:serializer -- reports/<session>
```

Preserve the entire session: source/tools/lock, build/maps, upstream transformer package, protocol/environment/
backend identity, calibration and original CDP/ps snapshots, input witnesses/all 20 samples, original auxiliary
and stock bodies, HTTP receipts, raw OTLP/manifests, deterministic analysis JSON/HTML and browser screenshots.
Replay checks hashes, run membership, byte equivalence, IDs/counts, completion ordering, phase separation and
source/build/manifest associations. Derived analysis must match its frozen JSON byte-for-byte. Raw reports are
ignored local artifacts; this experiment repository has no remote.

## Final local result — 14 November 2026

Session `serializer-1794644023258-125f`, Chrome 157.0.8103.78, all eight runs passed/finalized:

| Profile | Independent runs | Input spans/run | Body bytes | Serializer run medians ms | First call ms | Stock callback ms |
| --- | --- | --- | --- | --- | --- | --- |
| compact | 4 | 8 | 6389 | 0.1 / 0.1 / 0.1 / 0.1 | 0.7–0.9 | 18.6–37.6 |
| large | 4 | 128 | 317191 | 1.7 / 1.6 / 1.6 / 1.6 | 2.9–4.1 | 32.5–40.2 |

All 160 auxiliary calls are retained; all 544 unique input spans reached the collector. Byte equality passes for
all eight batches. Whole serializer-phase renderer CPU: compact 0.007569–0.009065 s, large 0.109125–0.113969 s;
whole export-phase CPU: compact 0.004431–0.006237 s, large 0.017287–0.018643 s. These different populations and
measurement scopes must not be interpreted as pure serializer CPU or production overhead.

76 JS and 8 Python tests pass; typecheck/build pass. Four mutations are caught: omit first sample, ignore stock
wire equality, conflate phase CPU snapshots, ignore offline serializer equality. Sources restored before final
collection. Six temporary-copy corruptions are rejected: SDK inputs/timings, auxiliary body, stock body, process
receipt, archived OTLP and missing membership. Originals remain unchanged. Existing A/B/CPU-source/pipeline frozen
analysis hashes remain identical. C three-mode regression `cost-source-1794644083969-412d` passes all nine fresh
runs/90 actions, including disabled with no SDK loading/export. Packed Observer displays all eight passed rows,
16 explicit unavailable measurements (pure network time/accepted budget) and zero page errors. Analysis and Observer
screenshots were inspected. Successful development pilot is separate from the final session.

Analysis SHA-256: `1ac1397a2a471303f0d3a601708d7b33700deed6f0ca7ce3c2b6bd2d1fb0524e`.
Source identity: `332994ecb7325b4ffccc039440b95059d316315d57940b00436a4c5ce5fa2a23`.
Packed backend 0.3.35 uses the installed graph via symlink, not a clean installation.

Saved viewer: `http://127.0.0.1:4328/performance?report=serializer-1794644023258-125f`.
Temporary collection servers close after completion; older viewers remain unchanged.

Next: metric-exporter/retry/compression validation, repeated mode/auxiliary/monitor-on-off/stripped-build studies
with independent CPU/RSS, then an explicitly accepted overhead budget. Full F and physical native D/E/F acceptance
remain open. Trace queue/drop fault validation remains in the separate pipeline gate.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
