# iOS native callback cadence — 12 November 2026

The experiment repo now has an app-local Objective-C++ CADisplayLink source on the main run loop, registered through
the pinned RN 0.88 native-module interop. The original JS scheduling scenario remains available; `cadence` adds native
acquisition to the same workload. Native callbacks append to a bounded buffer without calling JS or exporting per
callback, so collection continues during selected JS work. Observe's manual helper is reused; app-owned OTel exports
feed the separate existing collector/storage/UI. No Observer runtime or SDK package changes.

This is **callback cadence**, not compositor presentation, actual frame deadlines, hitches, dropped frames or input
latency. [Apple CADisplayLink](https://developer.apple.com/documentation/quartzcore/cadisplaylink) describes the source;
its display/target timestamps and actual callback arrival times are retained separately.

## Boundaries and clocks

Native buffer: 1024 records, explicit overflow counter, session IDs, generation guard against stale cleanup,
background/module invalidation cleanup, 8-second monotonic deadline checked in tick/stop plus scheduled fallback.
Main-run-loop starvation can delay cleanup; the deadline is not a hard real-time guarantee. Zero buffer drops means
no overflow of this buffer, not zero missed display updates or total producer-delivery completeness.

Seven JS/native ping pairs before and seven after acquisition retain JS-before/after, native-before/after and epoch
anchors. Under same-rate clocks, each pair bounds native-minus-JS offset between native-before−JS-after and
native-before−JS-before. Intersect all pairs under a constant-offset assumption; incompatible endpoints are rejected.
Count a native callback inside the selected JS body only when its complete possible JS-time range lies strictly
inside the recorded bracket, which includes instrumentation boundaries.

The reported round-trip transport half-width is not a full clock error bound: precision, drift between endpoint
samples and platform behavior remain unquantified. Compatible endpoint pairs do not establish exact cross-source
epoch alignment. No native-event-aligned timeline is emitted.

Enabled modes aggregate raw callback spacing into `observe.perf.native.display_callback.interval` (seconds, explicit
buckets), with ios.cadisplaylink source and callback-cadence-proxy attributes. Count = native callbacks−1. Export
occurs through app-owned JS OTel **after acquisition**. SDK histogram reporting timestamps are not native callback
timestamps; native timestamps and clock pairs remain in external artifacts. Disabled emits no OTLP but executes the
same external native/JS probes. It is not an uninstrumented overhead baseline.

## Actual Simulator evidence

Xcode 26.3 / RN 0.88 / Hermes Release, iPhone 17 Pro Simulator, runtime iOS 26.3.1. Session
`reports/ios-cadence-1794441662289`, six fresh processes, idle/blocked × three modes, fixed order:

| Evidence | Idle | JS blocked |
|---|---|---|
| Native callback counts by collection mode | 50 / 51 / 51 | 74 / 74 / 74 |
| Conditional callbacks strictly inside JS body | 0 / 1 / 0 | 24 / 25 / 24 |
| Buffer drops | 0 / 0 / 0 | 0 / 0 / 0 |
| OTLP spans: disabled / diagnostic / production_like | 0 / 2 / 1 | 0 / 2 / 1 |
| OTLP metric points | 0 / 4 / 4 | 0 / 4 / 4 |

Transport half-width ~0.007–0.014 ms in these Simulator samples; precision/drift remain unknown. Each delay histogram
has 16 JS observations; native interval count/sum match raw data in seconds. These single-condition checks are not
statistical performance, smoothness or overhead results. Native self-checks before the first workload reject duplicate
start/wrong-session stop, observe expiry, open Settings/return for real background stop, then verify restart. No
settings values change. This setup is outside the measured workload and prevents cold-start baseline claims.

The first expiry-only pilot failed before capture creation. Deadline checks were strengthened in native tick/stop,
and the complete native self-check then passed. 33 tests, three mutations (ignored drops, midpoint-only mapping,
incompatible clocks), web typecheck/build and native Release compile/link pass. Existing six-condition scheduling and
three-mode bootstrap regressions pass on the same artifact. Packed-backend browser shows separate JS/native histograms,
source/proxy raw attributes, selected-work trace and disabled empty state; fresh diagnostic page errors=0.

Source SHA `82e7c41ad512dfd0b587c047705a7c1f993109084179d1088f456fd727ce68d8`, embedded bundle SHA
`928b8ff93094451871c5b6cec5483c3e99e55c586bfa4f562f18eef0d289b01a`. Source artifact body, native .app snapshot,
raw archives, native/clock receipts, build/backend hashes/log and screenshots are retained locally. Backend is the
previous packed artifact with installed dependency symlinks, not a clean install. Old web experiment archives unchanged.

From the experiment repo after its documented Release build and loopback collector startup:

```sh
node tools/ios-simulator.mjs <BOOTED_SIMULATOR_UUID> cadence
```

The experiment repo's `native/CADENCE.md` documents the full contract; the temporary loopback receipt channel closes
after smoke. Next: independent Instruments/XCTest hitch/presentation corroboration, retained system artifacts and
physical Release/signing/repeated matched-device validation. T7 is partial; D/E/F conference acceptance remains open.
