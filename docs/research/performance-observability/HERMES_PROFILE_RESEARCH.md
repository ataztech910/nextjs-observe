# Hermes diagnostic: native download aggregation

17 November 2026. Follow-up to [native download measurements](RN_NATIVE_DOWNLOAD_RESEARCH.md), after the open
PR queue was merged. **Actual Hermes sampling on Debug Simulator; source attribution, not Release acceptance.**
The fixed title/abstract and original presentation remain unchanged.

## Finding

The rescan capture contains `accept` → `summarizeJobs` stacks and array filter/reduce/map work during native
download acquisition. The incremental capture does not show that aggregation path within the marked window.
This supplies an actual Hermes workflow for locating the store work outside React rendering. It does not explain
the slight worsening of median notification delay in the previous Release runs.

| Within acquisition markers | rescan | incremental |
| --- | ---: | ---: |
| Serialized sampling entries, including synthetic idle | 61,209 | 61,180 |
| Non-idle entries | 24,139 | 3,891 |
| Inclusive entries under `accept` | 21,006 | 14 |
| Inclusive entries under `summarizeJobs` | 17,085 | 0 observed |

Inclusive ancestor counts overlap; these are not invocations, exact CPU milliseconds or a speedup. Zero observed
entries is not zero work. Do not compare Debug latency with Release timings or use this ordered pair as a field
distribution. One fresh process per variant, iPhone 17 Pro Simulator / iOS 26.3.1, RN 0.88 / React 19.3 / Hermes.
Both runs preserve 16 real native XHR Blob bodies, 1,024 native progress callbacks and 16 native loads each.
Source is controlled loopback HTTP; notification controls are synthetic, not native input or presentation.

## Reproducible workflow and validity

The sibling experiment repo adds `research:rn-downloads -- <SIMULATOR_UUID> profile`. A separate Debug build and
profiling-enabled Metro are required; the complete build/capture/import commands are in
`performance-observability/native/HERMES_RESEARCH.md` at the workspace root. Capture/analysis live in
`tools/hermes-capture.mjs` and `tools/hermes-result.mjs` in that repo.

The external harness selects the matching app/device inspector target, verifies Debug/Hermes, saves the actual
loaded bundle with `Debugger.getScriptSource`, disables Debugger and starts RN CDP `Tracing` with the Hermes CPU
sampling category. Explicit app/harness handshakes surround downloads and stop sampling before full body verification.
The installed RN tracing implementation calls Hermes' sampling API. This is not an Instruments recording relabeled
as Hermes. Failed diagnostic runs require a fresh app process; the verification barrier is not a recovery API.

Analysis requires unique acquisition markers, complete profile coverage, consistent chunks, valid sample ancestry
and matching function names **and zero-based definition lines in that loaded bundle**. Debug receipt analysis needs
an explicit diagnostic option; the default Release validator still rejects Debug.

Both accepted raw JSON traces were imported into the actual React Native DevTools **Performance** panel using
Chrome/Playwright: Load profile (Cmd+O), expand the sampling thread, inspect flame chart and Bottom-up. Screenshots,
accessibility snapshots and the local import-check script are retained in the capture's `devtools/` directory.
The GUI's timing estimates are not adopted as exact CPU time. This does not complete the separate React Components
Profiler before/after workflow required by the brief.

An earlier completed pair contained Fast Refresh and is excluded. Writing captured JS under watched reports had
triggered it; Metro now excludes generated reports/captures/dist while preserving its defaults. Both accepted traces
contain no Fast Refresh event. Earlier failures (target registration, inspector Origin, CDP global expression) and
the contaminated pair remain retained, not silently replaced or counted among the two accepted profiles.

## Retained evidence

Local folder: `performance-observability/reports/hermes-download-1794943343804/`. Raw captures remain local/ignored;
the experiment repository has no remote. The source checkpoint is recorded in the workshop journal. Retained:
whole Debug `.app`, source/build manifest, binary/file hashes, loaded JS, inspector/target receipts, raw profiles,
per-run analysis and acquisition-time harness copies. The earlier contaminated folder is
`reports/hermes-download-1794942949889/`; three failed setup attempts precede it.

| Identity | SHA-256 |
| --- | --- |
| App source manifest | `e7f0c2973c5783d12b2e164a6dee9d31700f80fa1e067bdc76802724635fa059` |
| Loaded JS, identical in both captures | `fc9883bc9b91918774cea296d193466cf56c8f22f3f8f0ac29abf28e083fc2d3` |
| Rescan raw trace | `d1acc6d524158a9a960366ac12f07e74b02305980ced85ab45adfe2d874e002a` |
| Incremental raw trace | `b61107d14132e8e2f14b9f44ee532d01252c68705e4753b03280185206430367` |

Checks: 131 experiment tests; production web build; Debug native build; production Metro/Hermes bundle compilation.
Mutations removing the refresh rejection and generated-artifact exclusion fail their tests, then source is restored.
Both accepted attribution outputs replay identically; all eight previous Release download analyses replay identically.
All 276 original-presentation file hashes match. No Observer/runtime package was changed, so no package publication
or packed-app behavior is claimed by this documentation checkpoint.

## Next gates

[Four new Release pairs](RN_LATENCY_DECOMPOSITION.md) reproduce the tradeoff and localize a same-JS-clock component;
the cause remains open. [Native input feasibility](RN_NATIVE_INPUT_RESEARCH.md) now records an independent touch
timestamp/ack layout; isolate any causal intervention and validate a repeated input comparison separately.
Retain diagnostic attribution separately from ordinary physical Release performance. Validate a concrete React
DevTools Components/Profiler workflow, then startup, SSR hydration, Flashlight and an executable CI regression rule
against the unchanged brief. These remain required, not removed to fit the current evidence.

Observe/app adapters retain instrumentation; the harness captures/analyzes; the actual OTLP backend ingests/stores;
Observer frontend displays supported reports. This raw trace format is not a new Observer import contract, and no
instrumentation is moved into the frontend.
