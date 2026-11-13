# F source gate — independent renderer CPU and RSS

After merge #104 (`c5449a8`), this first F source-validation gate is implemented in the separate experiment
repository, local commit `bbc1bf0`. It uses the existing C app unchanged. It is not a complete overhead study
or an acceptable-overhead budget. The external harness collects CPU/RSS in disabled, diagnostic and production_like
modes without adding collection to Observer or changing Observe. Captures correctly retain `experiment=C`; the scenario
report identifies their F prerequisite purpose.

## Measurement contract

CPU comes from browser-level CDP `SystemInfo.getProcessInfo`: cumulative seconds across all threads of each process.
The sum covers **all renderer processes of one fresh, dedicated Chrome instance**, including default/spare renderers.
It excludes browser/GPU, external harness and collector processes. Membership must remain identical across snapshots;
PID disappearance/change, invalid source, backwards counters/clocks or conflicting raw projections reject the run.
This scope deliberately avoids pretending to identify one tab's exact JS thread from a browser-wide process list.

RSS comes independently from macOS `/bin/ps -o pid=,rss=,time= -p <renderer PIDs>`: 1024-byte units converted to bytes.
Raw output, parsed rows, full CDP process list and host monotonic acquisition brackets are preserved. OS cumulative
user+system CPU is a coarse cross-check. Delta agreement must be within max(50 ms, 25% of CDP CPU); this is a source
sanity bound, not an accuracy estimate. CDP and ps are fetched sequentially, not simultaneously; workload wall lies
between outer acquisition brackets, not exact CPU/RSS internal timestamps. Negative endpoint RSS changes stay signed.

Summed RSS can double-count shared pages. It is not private JS heap, peak memory, allocation volume, a leak estimate
or total browser/system memory. The adapter currently requires macOS and fails explicitly elsewhere.

A separate SDK-free browser calibration runs ≥700 ms of known busy work, retains a 64 MiB Uint8Array and writes every
4096-byte page. It must produce ≥0.2 s CPU in both CDP and ps and ≥32 MiB RSS rise. These bounds validate source
response to a known workload; they do not calibrate precision or subtract monitoring cost from results.

## Frozen run protocol

Three Latin-rotation blocks balance all three mode positions: nine fresh Chrome processes/profiles/contexts, ten
trusted clicks each, C degraded workload, zero warmup exclusion. Same production-profiling artifact and checksums;
1280×800/DPR1, local HTTP, no requested CPU/network throttling. OS cache is not flushed; thermal/power unmeasured.
The harness waits 250 ms after readiness and 16 ms between actions. Order is not randomized or carryover-balanced.

Two process snapshots bracket all ten actions, including automation gaps and React/UI work. No continuous polling,
CPU sampling profiler, tracing, forced GC or heap collection is enabled. Startup wall is external navigation-to-ready;
startup CPU remains unmeasured. App handler→Profiler timing is separate from external workload wall and CPU.

Shutdown/flush occurs **after** the second process snapshot. Both the app flush timer and external finish-click-to-
download wall are saved; the latter also includes UI/control/network/browser download overhead. Neither is pure
serialization cost. Browser OTLP POST body lengths/counts and run headers reconcile with captured decompressed
bodies. These bytes are not complete HTTP/socket traffic. Exact final span/histogram populations are replayed.

Disabled uses the same installed/profiling artifact and independent app harness; SDK initialization and export are
off. Build source maps identify SDK-bearing assets, whose requests are forbidden in disabled mode. Zero received
OTLP bytes remains distinct from unavailable peak memory and producer queue/drop counters. Installation cost,
stripped-build differences and monitor on/off distortion are separate unfinished measurements.

## Commands and preservation

Use Node 24, macOS and installed Chrome from the sibling `performance-observability` repository:

```sh
npm run build
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package npm run cost:sources
OBSERVER_PACKAGE_ROOT=/same/package npm run analyze:cost-sources -- reports/<session>
```

The session freezes original source/build/maps/lock/tools, schedule/environment/protocol, SDK asset index, backend
and analysis fingerprints. It preserves raw calibration/process/ps receipts, all app samples and requests, finalized
OTLP archives, deterministic JSON/HTML, scenario attachments and browser screenshots. Analysis recomputes source
projections, calibration, checksums, byte/population associations and requires byte-identical JSON. A new session ID
is used for each attempt; incomplete sessions never become successful by dropping runs.

The separate collector owns OTLP/archive storage; Observer reads the existing `observe.scenario-report/v1` shape.
No monorepo runtime, Observe instrumentation or new npm dependency is required. Installed dependencies are reused,
not clean-installed. Raw reports are local/ignored; this repository currently has no remote.

```sh
OBSERVER_PACKAGE_ROOT=/path/to/packed-observer/package \
CAPTURE_DIR=reports/<session>/captures \
PERFORMANCE_REPORT_DIR=reports/<session>/observer-reports \
OBSERVE_PORT=4326 npm run collector
```

## Actual local gate, 13 November 2026

Final session `cost-source-1794606600135-3f62`, Chrome 157.0.8103.78 on macOS 15.7.4. Separate calibration observed
0.710990 s CDP CPU, 0.71 s ps CPU and +77168640 B RSS (+73.59 MiB). No SDK is present on the calibration page.
All primary runs retain three renderer PIDs across each window. Per-snapshot acquisition wall is 6.18–22.68 ms;
this is observed collection latency, not a measurement of monitor-induced CPU/latency distortion.

| Mode, three runs in block order | Renderer CPU s | Endpoint RSS after MiB | App flush ms | Received OTLP bodies B |
| --- | --- | --- | --- | --- |
| disabled | .214333, .209836, .209145 | 279.078, 279.984, 279.094 | .1, .2, .1 | 0, 0, 0 |
| diagnostic | .268598, .295093, .211172 | 281.375, 281.188, 281.422 | 97.4, 33.5, 32.0 | 23822, 23873, 23859 |
| production_like | .210903, .212103, .214021 | 281.516, 281.953, 282.984 | 36.4, 26.5, 32.1 | 17022, 17032, 17016 |

These are retained observations, including slow diagnostic/flush runs. No overhead percentage or causal memory/CPU
attribution is computed. Three local repetitions and coarse endpoint measurements do not establish a budget.
Each disabled/diagnostic/production_like run finalizes with 0/20/10 spans and 0/3/3 metric points; each enabled final
histogram has count=10. Browser body counts/bytes reconcile; disabled loads no SDK-bearing assets and exports nothing.

64 JS and 8 Python tests pass; build/typecheck pass. Four mutations caught wrong RSS units, ignored CPU calibration,
SDK loading in disabled and ignored span population. Code restored before collection. Six temporary-copy corruption
checks reject calibration/process receipts/app samples/source maps/OTLP/missing membership. Original A/B replay
hashes are unchanged. The unchanged C app is exercised in all three modes against the same packed backend.

Observer browser validates nine passed rows and eighteen explicit unavailable queue/drop/peak-memory values with
zero page errors. Final analysis and Observer screenshots were inspected. The successful pilot is separate.
Analysis SHA-256: `d79213b4e8a70d716616b696d9acf9e8a64aa7e2d70eb1801d5accfd812101fd`.
Source identity: `032989e4b1a9e6a4bb5de0d8ad61827bf274ab4e0a218002ee88c3bdbadbf3e5`.

## Next F gates

Add producer queue/high-water/drop/serialization/export/flush accounting and steady/burst/large-trace workloads;
validate counters under deliberate saturation/failure. Then compare independent monitor-disabled/enabled and
auxiliary clock/aggregate/span/serialize/full-export modes, with a stripped build and defensible run-level uncertainty.
Native CPU/memory/presentation and physical-device D/E/F acceptance remain independent/open.

References: [CDP SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/),
[official protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).
macOS units were also checked against the installed `man ps` (rss: 1024-byte units; CPU time includes user/system).

Saved local viewer: `http://127.0.0.1:4326/performance?report=cost-source-1794606600135-3f62`.
Temporary collection/browser/preview processes close after completion; earlier A/B/native viewers are unchanged.
The packed backend is the retained 0.3.35 artifact with dependencies symlinked to the installed graph, not a clean
installation. Experiment code and ignored raw reports remain local because that repository has no remote.
The AI review hook reported unavailable/timeout and continued fail-open itself; hooks were not bypassed.
