# Experiment B — verified local bytes/startup gate

The separate `performance-observability` repository (local commit `2239d0c`, no remote) implements B.
No monorepo runtime/dependency changes are needed; the existing packed collector/storage and Observer report reader
consume its app-owned OTel and typed results.

B uses a dedicated `/b.html` entry and one production-profiling JS artifact. Baseline/degraded select 16/6000
redundant passes at startup via configuration; both return `-1845702791`. There is no padding or second compiled
application. This controlled case demonstrates that identical downloaded code can incur different configured work.
It does not compare the parsing cost of two different same-size bundles.

## Protocol and measurement boundaries

Before measured startup, `protocol.json` freezes the schedule, 2% size tolerance, minimum 50 ms paired compute and
navigation-to-ready gaps, source/build/encoded bytes inventory, analysis/backend fingerprints and environment.
Four matched blocks alternate baseline/degraded order, one automatic startup per fresh Chrome process/context,
zero warmup exclusions. A negative hypothesis remains a valid recorded outcome. Failed size comparability
invalidates the comparison. Two additional CPU/timeline diagnostics are explicitly gated and excluded from all
primary timing comparisons. Their readiness values stay unavailable in Observer with the gate reason.

All conditions run diagnostic OTel with the same profiling build, 1280×800 desktop/DPR1, no requested CPU/network
throttling. Chrome cache is disabled and service workers bypassed via CDP; responses are gzip/no-store. OS filesystem
caches are not flushed; thermal and power state are unmeasured. This is one local Mac experiment, with no field,
mobile, overhead, confidence-interval or population-effect conclusion.

The server pre-encodes actual gzip level 9 and Brotli quality 5 bytes and preserves both beside raw build files.
Only gzip is served. Each loaded JS ResourceTiming entry is joined to its artifact, raw Network response/cache flags
and server receipt. Encoded/decoded body sizes must equal preserved gzip/raw bytes. `transferSize` is the browser's
header-inclusive value, not exact socket/packet bytes. Brotli is an alternative artifact size, not a measured transfer.
Actual encoded response bodies have Content-Length and SHA-256; replay validates decompression roundtrips too.

Three timing endpoints remain distinct:

- Selected compute: app `performance.now()` bracket of `selectedLoadWork`; excludes imports, SDK and capture control.
- Module entry → ready: body entry after static imports through first `App.useLayoutEffect`, including async SDK,
  manifest fetches and capture-control requests, selected work and React commit scheduling.
- Navigation start → ready: browser navigation time origin through that same effect, including earlier loading.

None is total bundle CPU, parse/evaluation duration, paint, INP or native startup. Browser Long Task/LoAF entries are
retained with support/loss/background checks. Zero supported observations is not a proof of no jank. Profiled runs
retain original CDP trace/CPU samples and map minified frames through preserved source maps to `src/load-workload.ts`.
Trace markers and RunTask stay in CDP time; sampled frame counts are not CPU duration and are not epoch-aligned to OTel.

## Run and replay

From the sibling experiment repository, use Node 24 and installed Chrome. Reuse a matching built/packed backend that supports scenario reports:

```sh
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run experiment:b -- --blocks 4
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:b -- reports/<session>
```

The runner saves original source/locks/tools, build/maps, encoded artifacts, catalog, protocol, every raw ResourceTiming,
Network/server receipt, finalized OTLP capture, CPU/trace/source-mapping diagnostics, deterministic analysis JSON/HTML,
Observer scenario report, screenshots and browser verification. A fresh ID is used every attempt; failures stay
incomplete. Source snapshots use the existing installed dependency graph, not a clean dependency installation.
`analyze:b` replays raw OTLP, verifies all identities/counts/associations and requires byte-identical analysis JSON.

The existing `observe.scenario-report/v1` reader displays typed measurements and checks. Byte observations are also
exported as six `experiment.bundle.bytes` gauge points in By, distinguished by `measure`. Each startup has two spans
and three one-observation duration histograms. Observe/app owns collection; collector/archive storage and external
analysis are separate. Observer presents results without acquiring instrumentation responsibilities.

```sh
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package \
CAPTURE_DIR=reports/<session>/captures \
PERFORMANCE_REPORT_DIR=reports/<session>/observer-reports \
OBSERVE_PORT=4325 npm run collector
```

Open `/performance?report=<session>`. Main-thread traces remain external original artifacts instead of oversized
report attachments. Readiness is unavailable for gated diagnostics; the reason is explicit.

## Recorded local result, 13 November 2026

Final session `bundle-b-1794566743221-443a`, Chrome 157.0.8103.78. All eight primary startups loaded the same 18 JS
resources with identical hashes. All six byte comparisons have 0% paired difference against the predeclared 2% bound:
raw/decoded 368651 B, gzip/encoded 117765 B, Brotli artifact 112098 B, browser transfer 123165 B.

| Variant, block order | Selected compute ms | Module → ready ms | Navigation → ready ms | Long Tasks / LoAF |
| --- | --- | --- | --- | --- |
| baseline | 3.2, 1.5, 1.4, 1.6 | 93.3, 56.4, 48.7, 56.3 | 146.3, 90.1, 82.2, 90.1 | 0 / 0 each |
| degraded | 348.7, 349.7, 354.3, 351.2 | 411.4, 396.2, 413.7, 398.8 | 442.4, 424.4, 448.1, 434.3 | 1 / 1 each |

Paired compute gaps 345.5/348.2/352.9/349.6 ms and navigation-readiness gaps 296.1/334.3/365.9/344.2 ms all pass the
local descriptive ≥50 ms criterion. Independent diagnostic baseline/degraded: 29/36 main-thread tasks, max task
7.784/355.534 ms, 238/536 CPU samples, 18/318 mapped to selected source. These diagnostics are excluded above.

57 JS and 8 Python tests pass, build/typecheck pass. Four code mutations caught: ignore encoded body size, ignore disk
cache, force comparison valid, attribute unrelated CPU source. Restored before final collection. Six temporary-copy
corruption checks reject gzip body, raw samples, Network receipt, source map, OTLP body and missing membership.
Observer browser verifies ten rows with no page errors; screenshots inspected. C regression
`web-scenario-1794566774159-a535ac` passes on this build. Earlier A replay retains its original analysis hash.

B analysis SHA-256: `8d8894ac07683ce3c69a12c806b22b80db2a7e51f86037c465b2ad36b5255d82`.
Source identity: `bf98778be048e07e02980ed0f9f255ca5dc938206a5444d3f3fc9af4db433768`.
Raw data lives under ignored local `reports/`; preserve the full session directory. The experiment Git repository has no remote. Its tracked code/recipe is local; original raw reports are ignored.
The monorepo PR records this gate and its measured scope. Packed backend dependencies use the installed graph via
symlink, not a clean-install check. The AI review hook reported unavailable/timeout and continued fail-open itself;
hooks were not bypassed. Saved report viewer: `http://127.0.0.1:4325/performance?report=bundle-b-1794566743221-443a`.

The final session is separate from three incomplete two-block pilots and one successful two-block pilot. Early
trace categories exceeded the 64 MiB diagnostic bound; removing all disabled timeline categories then omitted
RunTask. The final limited set retains toplevel, timeline, user timing and disabled timeline without V8 execute/stack
events. A subsequent pilot exposed the analysis reading gauge attributes from the wrong level; it was fixed and
covered by a dedicated OTLP population test before final collection. Incomplete pilots stay incomplete.

Next: a separate web F measurement gate with independent CPU/memory and disabled/diagnostic/production-like modes,
including export/drop/queue/flush accounting. Native physical presentation and repeated-device D/E/F gates remain
open; this web study does not close them. Do not add instrumentation to Observer.

References: [W3C Resource Timing](https://www.w3.org/TR/resource-timing/),
[CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/).
