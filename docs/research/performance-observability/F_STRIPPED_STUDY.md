# F two-build comparison: installed Observe disabled versus stripped output

After monorepo merge #113 (`c7f2ad4`), the sibling experiment at local commit `0a24e1c` compares
two production artifacts of one plain DOM fixture. Monorepo branch: `step-performance-stripped-notes`. Observe/app instrumentation, external measurements/statistics, collector/archive and Observer UI
retain separate responsibilities. Instrumentation stays in the app and statistics in the external harness; the UI presents reports. This step changes no monorepo runtime or dependencies.

## Predeclared build policy

Both builds use `strip.html`, the same shell, `strip-main.ts`, `strip-work.ts` and deterministic `workload.ts`.
Vite production settings, target esnext, source maps, minification and API deduplication are identical. One compile
alias selects the adapter. `installed_disabled` retains the real Observe mode-switch/bootstrap path and its lazy
SDK/exporter output, selects disabled, and runs real disabled startInteraction/measureSync/end around each job.
`stripped` selects a direct callback adapter with no Observe/OTel import. Its **entire emitted JS/map graph** must
contain zero Observe/OTel modules, not merely zero loaded SDK modules. Installed maps must contain the real Observe
performance implementation/API plus lazy SDK/exporter modules. Both graphs must preserve byte-identical shared
shell/workload/scheduler source hashes against the archived originals.

This is an intentional two-artifact comparison, not same-artifact mode switching or pure probe CPU. Bundling/module
layout, loading, JIT and initialization effects remain in the contrast. The direct adapter still calls the common
harness closure; independent timestamps, checksums, pacing, automation and archive bookkeeping remain. Neither
build renders React or uses its profiling alias. This does not quantify React release-versus-profiling/native builds,
npm install duration, package node_modules footprint or uninstall the shared dependency graph.

A separate command builds only this entry twice. Ordinary experiment builds remain separate; existing source
inventories include the new files but old analysis algorithms stay unchanged. Each variant's build-index/metadata
must join its own finalized archive. Empty archives are intentional: **both runtime modes are disabled**, no SDK/
exporter-bearing asset may load and no OTLP request/span/metric point may appear. Module maps and actual network
receipts validate these properties independently of the page's policy label.

## Bytes and startup endpoints

Preserve both complete artifacts/maps plus exact raw, gzip9 and Brotli5 encodings and catalog SHA-256s. Gzip9 is
actually served with no-store; Brotli5 is artifact-only. Every loaded JS GET joins original decoded response body
hash, original response headers, gzip server body hash/length, artifact identity and browser ResourceTiming
encodedBodySize/decodedBodySize. Loaded JS totals include only observed scripts. Separately report total emitted JS,
including unused lazy chunks, excluding source maps/non-JS. Those emitted bytes are not all downloaded. Browser
transferSize is browser-reported transfer, not full socket/TLS/network cost. Deterministic sizes of these two builds
are not six independent build replications.

The app records browser `adapterReadyMs` immediately after shared module evaluation/adapter initialization, **before
fetching the variable-sized build index or creating an archive**. With navigation.startTime=0, this is navigation to
adapter-ready, including navigation/static dependency loading/evaluation and adapter setup, not paint/INP. Module
entry follows dependency evaluation; it is not parse/evaluation CPU. The host navigation-to-harness-ready endpoint
additionally includes build-index/archive metadata and automation. Their different scopes are retained, not merged
into one startup cost. Startup CPU still has no validated stable-PID interval and remains unavailable.

## Work, process scope and uncertainty

Six alternating adjacent stripped/installed-disabled pairs, three of each order:12 fresh Chrome processes/profiles/
contexts,64 deterministic degraded jobs at100ms absolute targets per run. One trusted click starts all; no action
pooling. Shared scheduler rechecks early wakeups, retains first/late/quantized jobs and never skips/overlaps work.
Plain DOM job/body completion is not React commit/paint/INP, unrestricted throughput, established stationarity or
production app acceptance. No timing exclusions or timing-selected reruns. Fixed order/no randomization, visible
1280x800/DPR1,250ms settling, no requested CPU/network throttling. Fresh profiles/no-store do not flush OS caches;
thermal/power/cache unmeasured.

Separate SDK-free busy/retained-page-touched64MiB calibration precedes primary work. Three external CDP/macOS ps
endpoint snapshots separately bracket workload and no-op adapter finish. CPU includes all threads/all renderers,
including spares; excludes browser/GPU/collector/harness. Stable PIDs and coarse source agreement required. RSS is
an endpoint sum that can double-count shared pages, not private heap/peak/leak. Host/browser clocks not aligned.
Response-body retrieval/hashing, evidence cloning and archive finalization happen after both process windows.
Both groups keep external sampling/HTTP witnesses; their observer effect is not isolated. Concurrent drain and
concurrent evidence/finalization each share one promise, checked in every browser run.

13 descriptive installed-disabled minus stripped contrasts preserve six exact paired IDs/endpoint values. All
6^6=46656 empirical paired-block bootstrap draws yield exploratory95% nearest-rank mean intervals assuming
exchangeable blocks. Small n/fixed order/unmeasured host conditions, no p-values/multiplicity correction/accepted
budget or equivalence criterion. Collapsed byte intervals describe these two builds, not population uncertainty.
Negative/zero-spanning timing intervals establish neither speedup, equivalence nor acceptable instrumentation cost.
Previous studies have different artifacts/protocols and are not matched controls.

## Run and preserve

From sibling `performance-observability`, Node24 and installed Chrome:

```sh
npm test
npm run build:f-stripped
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:f-stripped
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:f-stripped -- reports/<session>
```

Preserve whole session: source/lock/tools/configs, both builds/maps, raw/gzip/Brotli bodies/catalog, protocol/environment/
backend hashes, calibration, original CDP/ps/host brackets, all job targets/start/end/lateness/checksums, original
browser response headers/body hashes, server logs, ResourceTiming/navigation, empty captures/finalized manifests,
analysis JSON/HTML/screenshots. Offline replay checks all hashes/encoding roundtrips/source graph/common source
identities, build/run/archive/HTTP/body associations, exact checksums and empty telemetry. Observer presents existing
typed per-run reports and attached external analysis. Passing means integrity, not accepted overhead. Startup CPU,
producer queue/drops, peak memory and accepted budget remain explicitly unavailable.

## Final local result — 14 November 2026

Session `stripped-1794680848671-8f54`, Chrome157.0.8103.78:12 passed/finalized,768 jobs. Both policies have
zero loaded SDK/exporter assets and zero OTLP requests/spans/metric points; empty finalized captures are intentional.
Stripped output has1 JS file/1 linked map,0 Observe/OTel modules. Installed output has16 JS files/14 linked maps,
1 Observe performance module/192 unique OTel module sources and6 mapped SDK-bearing chunks. Two unmapped installed
files are verified pure re-export facades pointing to mapped SDK/resource chunks; neither facade loads in any run.
A separate preserved build-coverage check verifies JS/map links, facade targets and actual absence of facade GETs.
This is output-module evidence, not an installed-package disk-size claim.

| JS body scope | Stripped, B | Installed disabled, B | Difference, B |
| --- | ---: | ---: | ---: |
| Loaded raw | 3711 | 19623 | 15912 |
| Loaded gzip9 | 1871 | 8275 | 6404 |
| All emitted raw | 3711 | 130848 | 127137 |
| All emitted gzip9 | 1871 | 44100 | 42229 |
| All emitted Brotli5 | 1756 | 42596 | 40840 |

All six runs/policy retain identical byte totals, but these are only two built artifacts; repeated byte values do
not represent build-population replications. Loaded body sizes/hashes exactly match browser/server/catalog evidence.
Unused installed lazy SDK bytes contribute to emitted distribution size and are not charged as downloaded bytes.
Brotli is artifact-only. Map/non-JS bodies are excluded from this table.

Selected installed-disabled minus stripped mean differences [exploratory95% paired intervals]:

| Endpoint | Mean difference [interval] |
| --- | --- |
| Workload renderer CPU, ms | -0.933 [-31.797,31.921] |
| No-op finish renderer CPU, ms | 0.008 [-0.269,0.254] |
| RSS after work, MiB | -2.836 [-8.180,0.872] |
| Paced body, ms | -0.233 [-3.950,2.717] |
| Within-run job median, ms | -0.733 [-2.167,0.517] |
| Navigation to adapter-ready, ms | 21.433 [1.450,44.650] |
| Navigation to harness-ready wall, ms | 32.424 [7.234,62.874] |
| Workload wall, ms | -4.994 [-21.765,8.080] |

CPU seconds are converted to milliseconds only in this table. The startup difference describes these two local
artifacts including dependency loading/evaluation and setup; no isolated parse/CPU/probe attribution follows.
Harness-ready includes different metadata/archive setup, so it is not substituted for pre-archive readiness.
Work CPU/body intervals span zero; no speedup/equivalence or acceptable overhead follows. RSS is not private heap
or retained-memory savings. All13 contrasts/exact paired values remain in JSON/HTML. Independent calibration detects
0.708911s CPU/+73.641MiB endpoint RSS.

114 JS+8 Python tests, ordinary build and both dedicated builds/typecheck pass. Real Observe disabled/direct
adapters preserve all64 jobs/results/errors/late observations; tests reject retained instrumentation, changed common
source, wrong original HTTP bodies/cache/encoding, loaded SDK, altered build/archive/source/timing/membership.
Five mutations caught: remove pacing, allow OTel in stripped, ignore common-source hash, ignore original response
body hash, allow disabled SDK load. Sources restored before the first/final primary collection; no pilot or timing-
selected rerun. Eight temporary-copy corruption checks reject sample/readiness/resources, original HTTP/process
receipts, capture manifest, frozen adapter, source map, gzip body, catalog and missing membership. Original evidence
unchanged; deterministic replay byte-identical. Prior eleven A/B/CPU/pipeline/serializer/metric/mode/burst/auxiliary/
paced/monitor analysis hashes unchanged. Packed reader12 passed/48 explicit unavailable/page errors0; final UI/
analysis screenshots inspected. C regression `cost-source-1794681004877-ae95`:9 fresh runs/90 actions/3 modes pass,
including no SDK-bearing asset/OTLP in disabled.

Analysis SHA-256:`518f6fc78885bb58c92bc6b02f005063251d55da6f01222e0b728bd583cd02d4`.
Common source identity:`4b44d2a713d5d7bcc861dc4bf44b5ee13ac8c7c6c03c890fcec4f520d5a3dbaf`.
Saved viewer:`http://127.0.0.1:4335/performance?report=stripped-1794680848671-8f54`.
No new dependency/native build or Observe/Observer runtime change. Packed backend0.3.35 reuses installed dependencies
via symlink, not a clean install. Experiment Git has no remote; ignored raw reports remain local. Preserve the entire
session with its local source commit. Temporary servers close; older saved viewers remain unchanged.

Next: consolidate the scoped F evidence and explicit remaining acceptance gates. Startup CPU, broader JS/native/
external monitoring, longer-duration convergence, compression/wider retries, an agreed overhead budget, full F and
physical native D/E/F acceptance remain open; completing this stripped fixture does not close those gates.

The experiment commit hook reported AI review unavailable/timeout and continued fail-open itself; hooks were not bypassed.
