# iOS scheduling workload — 12 November 2026

The separate experiment app now implements the JS portion of experiment D on a native Release Simulator host.
It reuses `next-observe/performance`, explicit app-owned OTel providers and the existing packed collector/storage/UI.
No instrumentation moved into Observer; this monorepo increment changes documentation only.
The preceding host setup is documented in [PR #97](https://github.com/ataztech910/nextjs-observe/pull/97).

## Workload and measurement contract

RN 0.88.0 / React 19.3.0, Hermes 260318099.0.4, Xcode 26.3, iPhone 17 Pro Simulator (runtime reports iOS 26.3.1).
Two variants: idle negative control and 8,000,000 selected integer iterations, checksum 3644786808. This is a fixed
workload, not a time-target spin or same-work optimization. A looping 2-second translate animation requests
`useNativeDriver:true`, `isInteraction:false`. RN's [Animated documentation](https://reactnative.dev/docs/animated#using-the-native-driver)
explains the configured execution path; configuration does not establish actual frame presentation.

The controller waits up to 5 seconds for foreground activation, requests animation and a 300 ms warmup, opens an
explicit JS interaction, arms a 20 ms deadline probe and schedules selected work after 80 ms. A separate synthetic
response callback is scheduled immediately before the selected body with a 20 ms deadline. It is not touch latency.

There are 16 actual timer samples. Lateness is max(0, actual monotonic callback time minus expected deadline).
Each callback rearms from a fresh clock reading after recording, without producing fake missed ticks after a stall.
Observation-window length varies with actual lateness. Any transition away from active invalidates the workload;
subscriptions/timers/animation are cleaned up, and failure leaves the capture unfinalized.

Diagnostic keeps the interaction root and selected-body child. Production-like keeps the root and body histogram.
Both export `observe.perf.js.event_loop.delay` in seconds, explicit buckets, count 16, foreground/probe-interval
attributes, and selected work attributed to `native/scheduling.js`. Completion is an explicit JS window marker.
Disabled emits no OTLP but still runs the external probes, animation, workload, UI and control traffic.

## Reproduction and scope

In the separate experiment repo, build the Release host using `native/host/README.md`, start its capture-enabled
loopback collector, then run:

```sh
node tools/ios-simulator.mjs <BOOTED_SIMULATOR_UUID> scheduling
```

Six fixed-order conditions (idle/blocked × three modes), fresh process per condition. Harness checks the same
Release/source identity, Hermes/runtime readiness, finalized populations and checksum. It retains matching source
manifest body, build hashes, screenshots, query snapshots and actual receipt samples, including disabled, through a
temporary loopback-only artifact receiver. That receiver is separate from OTLP and closes afterward. Raw collector
archives remain the backend's responsibility. Omitting `scheduling` runs the original bootstrap smoke.

This is a functional smoke with one run per condition. Timer policy, GC, OS scheduling and Simulator timing affect
the results. Lateness is not CPU time, utilization, native jank or a dropped-frame count. No native frame/input
source, calibrated JS/native clocks or physical performance acceptance is provided. D/E/F acceptance remains open.

Next: independently collect and validate iOS cadence/hitch evidence while JS is blocked; retain original native
artifacts and source-clock uncertainty. Physical Release/signing and repeated matched-device runs remain required
for physical performance claims. No inferred FPS or presentation endpoint should be added from the JS samples.


## Verified functional session

Final session `ios-scheduling-1794440751483`: six finalized conditions, source SHA-256
`70fd85973087dd0a75604f9c865f64316794f2887cb35dc7182d5333b337b0be`, embedded bundle SHA-256
`d2770e8e7947d25160dd7626a1caa2aa3c6e9cc38d4d027cb592f0ac32e07c4a`.

| Observation | Idle | JS blocked |
|---|---|---|
| Maximum scheduling lateness across each mode's 16 samples | 13.3–13.5 ms | 391.8–395.6 ms |
| Synthetic response lateness | 13.3–13.5 ms | 375.2–378.9 ms |
| OTLP spans: disabled / diagnostic / production_like | 0 / 2 / 1 | 0 / 2 / 1 |
| OTLP metric points: disabled / diagnostic / production_like | 0 / 3 / 3 | 0 / 3 / 3 |

These ranges describe individual functional runs across three collection modes, not statistical estimates or an
instrumentation-overhead comparison. All runs have 16 external raw samples; enabled delay histograms have count 16.
Raw sums converted to seconds match OTLP sums, and selected work/checksum/source/event associations were verified.
The original bootstrap regression also passes on the same artifact (session `ios-bootstrap-1794440766803`).

27 tests, three focused mutation checks, web typecheck/build and native Release compile/link pass. Early incomplete
pilots exposed cold inactive AppState; bounded activation wait fixes startup while preserving background invalidation.
Packed-backend browser checks cover root/body timeline, synthetic-not-input events, seconds/count 16, source/Simulator
metadata and disabled empty state; fresh diagnostic navigation reports no page errors. Raw archives, native app copy,
build log, receipts, screenshots and matching source artifact body are preserved locally. No new dependencies added.

Experiment implementation is local commit `f0a4477` on `step-ios-js-stall`; that repo has no remote yet.
