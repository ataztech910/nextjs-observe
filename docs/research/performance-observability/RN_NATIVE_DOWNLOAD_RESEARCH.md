# RN follow-up: real native downloads, median versus tail

17 November 2026. PR #123 was merged at the speaker's explicit request (merge `cc68247`). Continue the
[progress-pressure research](RN_EVENT_PRESSURE_RESEARCH.md) using an actual native source. **Exploratory local
Simulator evidence; no physical-device, touch/presentation or full conference acceptance.** The fixed title and
abstract remain requirements. Original presentation, archived measurements and full F status are unchanged.

## Research decision

Retain the case, with a more precise story: incremental store updates reduced the observed notification latency
tail, while the median became modestly worse. Small React render durations did not describe that tail. Do not
say that every endpoint improved or present the model pilot's 41 ms extreme as a real-download result.

Sixteen requested downloads produced only six overlapping source responses in this setup, and about 104 native
progress callbacks/s over the full transfer window. This is an observed scheduling result, not a universal RN
connection limit or evidence of which layer imposed it. We did not force the model's 320 callbacks/s into native
networking to preserve its conclusion.

## Real acquisition and protocol evolution

The existing RN 0.88 / React 19.3 Release/Hermes host issues actual loopback HTTP `XMLHttpRequest` downloads with
`responseType='blob'`. The installed native networking path emits progress. WebSocket is retained only for clock
pings, independent control notifications and the receipt. Synthetic WebSocket progress is rejected in this mode.
Files are deterministic binary fixtures, not real user photographs, SDK/customer incidents or production traffic.

A first native-source smoke (`native-download-1794941011387`, two processes) did **not** reproduce the previous
worst delay: its three inherited control points saw rescan layout-effect lower endpoints around 0.9–1.0 ms and
incremental up to 4.3 ms. Preserve this negative coarse observation. That protocol used size/checksum validation;
it is not pooled with the following dense protocol or relabelled an invalid run.

The separately declared v2 protocol (`native-download-1794941152711`) samples the whole transfer window with
controls every 137 ms, incommensurate with 50-ms source writes. It runs four or sixteen requested files, 8,192
history rows, both variants and reversed variant order in a second block: eight fresh processes. Each file has 64
writes. Networking decides actual delivery/coalescing and connection scheduling; source writes are not assumed
to correspond one-to-one to progress callbacks. Display refresh requests stay at 250 ms, plus control updates.

Every acquired progress callback updates the store. `native-load` is a separately labelled completion callback,
not a fabricated progress observation. Same full final rows and summaries are required. No debounce, dropped
messages or work deferred beyond completion manufacture the comparison.

Payload bodies are prepared before acquisition. After all loads and a drain opportunity, client FileReader output
is compared to the **exact expected base64 bytes**, not merely length/a rolling hash. Analysis rejects any control
layout overlapping payload verification. The 300-ms drain delay is not by itself accepted as proof of separation.
The source stops emitting controls at its final write. Runtime callbacks, source writes, final state and bytes are
retained and checked independently. These checks do not establish a general absence of native producer losses.

## Every dense-protocol run

Each row below is one process. The 23/71 controls within it are correlated samples, not independent benchmark
replications. Nearest-rank median/p95 summarize that process's **lower endpoints** of clock-transport-bound
source-send→layout-effect intervals. They are not field percentiles, confidence bounds or exact calibrated latency.

| Block | Files requested | Policy | Native progress/s | Controls | Layout median, ms | Layout p95, ms | Layout max, ms | Max React render, ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | rescan | 77.60 | 23 | 1.619 | 9.631 | 12.856 | 1.725 |
| 0 | 4 | incremental | 78.50 | 23 | 3.295 | 4.494 | 5.392 | 1.485 |
| 0 | 16 | rescan | 104.50 | 71 | 1.419 | 19.043 | 20.459 | 1.749 |
| 0 | 16 | incremental | 104.15 | 71 | 3.130 | 4.811 | 6.060 | 1.441 |
| 1 | 4 | incremental | 78.55 | 23 | 3.495 | 5.248 | 7.448 | 1.423 |
| 1 | 4 | rescan | 78.52 | 23 | 1.687 | 13.962 | 16.569 | 0.825 |
| 1 | 16 | incremental | 104.41 | 71 | 4.099 | 5.918 | 6.441 | 1.678 |
| 1 | 16 | rescan | 104.50 | 71 | 1.479 | 18.670 | 20.244 | 0.751 |

Per-message measured service-window p95 ranges were 4.257–4.399 ms rescan and 0.023–0.033 ms incremental. These
are not whole-task, isolated CPU or GC measurements. Source overlap peaked at four responses for four requested
files and six for sixteen; callback rates include transfer waves. Across v2 there are 376 control observations,
5,120 native progress callbacks, 80 verified bodies and 83,950,592 verified bytes. In these runs native callback
counts happened to match source writes. Do not generalize that equality to other conditions.

Two process runs per cell, no warmups, fixed condition order and no predeclared performance budget: this remains
exploratory. Clock pairs bound a constant offset before/after; maximum transport half-width <0.102 ms. Precision/
drift remain unknown. Source-send includes loopback/native transport and JS waiting. Neither synthetic notification
receipt nor React layout effect is a measured touch or presentation endpoint. Whole-scene React render samples
come from an opt-in **profiling artifact**, not an ordinary Release comparison or a React DevTools UI recording.
No Hermes sampling profile was collected here; the cause of the median change is not established by these timings.

## Implementation and evidence location

Separate local experiment repository: branch `research-rn-native-downloads`, commit `35a8b21`, no remote.
[Full local protocol and reproduction commands](../../../../performance-observability/native/NATIVE_DOWNLOAD_RESEARCH.md).
App-local `native/downloads.js` acquires callbacks/body validation; external `tools/download-pilot.mjs` serves bytes
and runs the study; `tools/download-result.mjs` validates/replays. Native XHR uses installed RN functionality;
no Pod, native project, dependency or system transport-policy changes were required.

Ignored `performance-observability/reports/native-download-1794941152711/` preserves protocol written before
acquisition, source writes/client callback records, controls/clocks/layouts/renders, exact-body validation flags,
source manifest, matching source/tool copies, per-run analysis, summary, screenshots and copied `.app`.
The initial two-run smoke keeps its separate artifacts. Simulator: iPhone 17 Pro type / iOS 26.3.1,
UUID `84FECE7E-DB76-474C-B6CF-E2229FD32F93`.

- Source SHA: `1e36dd448b60386bdef236de159613e255abcdbb115a4a2cfd4b569116c9d1a5`.
- Native executable SHA: `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`.
- Embedded bundle SHA: `68903ea49a49a1f1d4adbde595894817ea1221532cfd4877d9c1f2e0ced71f40`.

Checks: 125 experiment tests pass (six new native-acquisition/validation tests), web typecheck/build, native Release
compile/link, two initial smoke runs and eight dense-protocol Simulator runs. Mutations disabling exact-byte
verification or allowing probe/layout overlap with payload verification were rejected, source restored and targeted
tests passed. The shared control-analysis refactor replays all 20 retained model sweep/phase runs and all eight
native runs to identical saved analyses. All 276 recorded original-presentation hashes remain unchanged. Commit
hook AI review was unavailable/timeout and continued automatically; it was not bypassed.

This monorepo change is documentation only. App/Observe owns collection, the external harness owns comparison,
OTLP backend owns ingestion/storage and Observer frontend reads supported reports. This pilot's raw JSON is not
a new supported Observer schema; no instrumentation was moved into its frontend.

## Next gates

Capture actual Hermes CPU samples and React DevTools workflow to locate the callback/store path and investigate
median behavior. Then independently timestamp native input and declare its completion endpoint, with physical
ordinary Release comparisons separate from diagnostic captures. Validate source/history realism and freeze a
confirmatory protocol before a regression budget. Startup, hydration, Flashlight and CI regression workflow remain
separate requirements of the unchanged talk brief. No new slides claim those gates complete.

API reference: [RN networking](https://reactnative.dev/docs/network) and
[RN XMLHttpRequest](https://reactnative.dev/docs/global-XMLHttpRequest). Actual callback-path behavior was also
inspected in the installed RN 0.88 `RCTNetworking.mm`, `RCTNetworkTask.mm` and `XMLHttpRequest.js`; the observations
above come from the retained runs, not assumptions based on documentation alone.
