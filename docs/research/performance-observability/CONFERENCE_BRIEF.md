# Fixed conference brief and delivery requirements

Status: 17 November 2026. The speaker explicitly fixed the title and description. Adapt the experiments and
presentation to these requirements; do not reduce the published promises to fit the evidence already collected.
The total slot is 30 minutes including questions. A 25-minute talk and 5-minute Q&A remains a working allocation.
The previous evidence-only deck is a partial draft, not acceptance of this brief.

## Title — unchanged

From Profiler to Production: Measuring What Actually Matters in React & React Native

## What this session covers — unchanged

Every React developer knows how to open DevTools. Far fewer know which numbers to trust — and which ones are lying to you. Lighthouse scores look great in reports but don’t always correlate with real user experience. Bundle size matters, but not in the way most teams optimize it. And in React Native, the JS thread can be silently killing your UX while your profiler shows green. I work on the Dynatrace React Native agent — SDK-level instrumentation that runs inside production apps across a wide range of codebases. That gives me an unusual vantage point: not just how one app performs, but what patterns consistently hurt performance across many apps, on both web and mobile. In this talk, I’ll walk through the metrics that actually matter — TTI, JS thread jank, startup time, hydration cost — and show how to measure them properly using Hermes profiler, Flashlight, React DevTools, and custom instrumentation. I’ll share real before/after benchmarks from web and React Native projects, and explain how to build a measurement culture in your team so performance doesn’t regress the moment you stop watching. No generic advice. No “just memoize everything.” Real numbers, real tools, real workflows.

## Required coverage and current gaps

These are delivery requirements, not optional stronger claims. “Available” means retained local evidence with its
original limitations; it does not establish production or device generality. Each completed row needs a reproducible
command/workflow, retained raw evidence and a place in the main talk. A tool name or appendix alone is insufficient.

| Requirement | Reusable evidence | Work needed before accepting the talk |
| --- | --- | --- |
| Lighthouse versus experienced responsiveness | [A](EXPERIMENT_A_GATE.md): eight load scores of 100, four matched post-load comparisons. | Keep load and later interaction endpoints distinct; show the interaction and its measurement, not just scores. |
| Bundle size versus execution | [B](EXPERIMENT_B_GATE.md): identical artifact/transfer bytes, different configured work. | Keep the controlled same-artifact claim; connect bytes, execution and readiness without claiming pure parse time or a universal optimization. |
| TTI | Endpoint discussion exists; no retained legacy TTI experiment. | Explain the legacy definition and retirement from Lighthouse; demonstrate explicit app readiness and interaction separately. Do not rename a layout effect or startup mark “TTI.” If showing a legacy TTI number, pin its actual implementation and protocol. |
| Web startup and hydration cost | B has navigation-to-first-layout-effect, not SSR hydration. | Add an SSR/hydrate experiment with declared server, navigation, hydration and usable-interaction boundaries; distinguish hydration work from waiting, render and paint. |
| Web before/after and React DevTools | C has baseline/degraded/optimized repeated runs; custom React Profiler integration exists. | Audit C equivalence and contrasts, capture an actual React DevTools workflow locating the costly work, apply the fix and repeat release measurements. The Profiler API alone is not that workflow. |
| RN JS jank and user impact | [iOS callback cadence](IOS_NATIVE_CADENCE.md), [Instruments](IOS_SYSTEM_PROFILER_GATE.md), an actual [native touch gate](RN_NATIVE_INPUT_RESEARCH.md), and a [paced pilot with no-download control](RN_PACED_INPUT_RESEARCH.md). | The paced pilot missed 4/27 declared phase budgets, so a controlled before/after input comparison remains open. Calibrate injection before accepting that claim; sparse taps do not establish UX improvement. Measure JS responsiveness and the user-visible endpoint separately. Show which profiler/view looks healthy and why it misses that endpoint. Layout effects/callback cadence are not presented frames. |
| RN startup | Release host/bootstrap runs exist, without cold-start performance acceptance. | Declare native launch-to-usable boundaries, cold/warm conditions and repeated runs; do not substitute JS module startup for app startup. |
| Hermes profiler | [Two clean Debug Hermes sampling profiles](HERMES_PROFILE_RESEARCH.md), loaded-source attribution and actual RN DevTools Performance imports locate full-history aggregation. Instruments is separate evidence. | Integrate this reproducible diagnostic workflow into the main talk with its Debug/Simulator limits; keep source attribution separate from Release benchmarks. The overall tool workflow and talk acceptance remain pending. |
| Flashlight | No retained Flashlight run. | Establish a supported Android execution route, collect a real report and show its interpretation/limits. Only an iPhone is currently confirmed; Simulator iOS evidence cannot satisfy this row. |
| RN before/after | Functional Maestro runs and Simulator stall observations exist. | Retain an equivalent-work optimization comparison, repeated release runs and diagnostic captures. State device/build conditions. Physical-device validation remains open; Simulator results cannot establish physical performance. |
| Custom instrumentation | Observe adapters, OTLP, archive and report replay exist. | Show how app-owned spans/metrics connect the profilers to repeatable measurements; keep collector/archive ownership explicit. |
| Measurement culture and regression prevention | Playwright/Maestro reports and delivery validation exist. | Demonstrate baseline → repeated comparison → justified budget/decision rule → CI result → retained report/owner. An intentional regression must fail the performance rule, not merely a functional assertion. |
| Speaker production perspective | Speaker-provided Dynatrace RN SDK background. | Connect the lab cases to patterns observed in SDK work, using material the speaker may share. Label controlled lab data as such; do not imply it is customer production telemetry. |

## Execution order

1. **RN interaction before/after first.** Extend the existing Release host rather than starting another viewer.
   Choose one blocking computation and a concrete input-to-result interaction. Preserve output and business semantics
   across the fix. Declare primary endpoint, repetitions, warmups, ordering and invalid-run rules before collecting
   accepted runs. Keep profiler-attached diagnostic runs separate from primary timing. Capture the original/fixed
   source identity, Hermes recording, JS scheduling observations and native/system evidence where supported.
   Simulator can establish the workflow now; physical performance acceptance remains explicitly pending.
2. **Resolve named-tool feasibility in parallel with protocol preparation.** Validate Hermes profiling on the installed
   version; establish Android access for Flashlight without assuming a device exists or purchasing a service.
   Record any unsupported configuration as a blocker, not a successful tool demo or a reason to delete the promise.
3. **Web before/after plus hydration/startup.** Reuse the C comparison where valid, add the missing SSR fixture,
   and retain React DevTools captures alongside independently repeated timing. Add RN startup acquisition with
   native launch anchors. Preserve cold/warm distinctions and do not pool web/native endpoints.
4. **Regression workflow.** Freeze the baseline and decision rule after assessing measurement variability; store
   machine-readable outputs and trace/profile/report links. Verify the rule against a deliberate slowdown and a
   normal comparison. Define who reviews a failure and how a justified baseline change is recorded.
5. **Rewrite and rehearse the new deck around the accepted results.** Keep the title/description and the original
   presentation untouched. Missing evidence stays visibly pending until collected. Screenshots of reports are
   allowed as stage fallback; invented values and unrelated profiler captures are not.

For each experiment, retain source/build identity, device/OS/runtime, instrumentation mode, commands, raw samples,
exclusions with reasons and the declared comparison. Prefer paired/repeated comparisons and show uncertainty;
do not select one favorable run. A fixed amount of work must still finish after a scheduling fix—deferring it beyond
measurement is not an optimization result. Report the interaction gain and any completion/startup tradeoff separately.

## Proposed 25-minute main route

This is an allocation for the replacement talk, not a claim that the missing scenes are ready or timings rehearsed.

| Window | Content required in the main talk |
| --- | --- |
| 00:00–01:30 | Title, speaker and GDG Linz photographs/context. |
| 01:30–04:00 | Which endpoint to trust: load score versus interaction; TTI definition and limits. |
| 04:00–09:00 | Web case: bytes/execution, startup/hydration, React DevTools → fix → measured before/after. |
| 09:00–18:00 | RN case: startup and JS responsiveness, Hermes/Flashlight workflows, fix and before/after; device/tool limits visible. |
| 18:00–21:00 | Custom instrumentation connects profiler findings to repeated measurements through OpenTelemetry. |
| 21:00–25:00 | Baseline, regression rule, CI failure/report and ownership; practical closing workflow. |
| 25:00–30:00 | Questions. |

Move detailed F delivery fault cases, SDK cost studies and architecture internals to supporting material unless they
are needed to explain a measurement in the main cases. RN and named tool workflows cannot be relegated to Q&A.
If rehearsal does not fit, shorten explanations and navigation; do not remove a promised topic silently.

## Architecture and preservation constraints

- Observe/app adapters own instrumentation. The external experiment harness owns orchestration and comparisons.
- The actual collector/storage backend owns OTLP ingestion and persisted evidence; Observer frontend reads it.
- OpenTelemetry is the interoperability boundary. Do not move instrumentation into Observer.
- Start from the existing report reader. Extend it only for concrete new artifact/schema needs uncovered by the experiments.
- Preserve `workshop-slides/` at its existing location. Apply new content to the separate performance presentation;
  keep the speaker/GDG photo work and copied engine changes available on their existing branches.
- Historical protocols, raw data and evidence indexes remain authoritative for their collected runs. This brief
  changes talk acceptance, not old measurements or the broader full-F acceptance status.

## Tool reference points

Check support against the installed versions before running a protocol:

- [Lighthouse TTI documentation](https://developer.chrome.com/docs/lighthouse/performance/interactive): TTI retired in Lighthouse 10; explicit readiness must retain its own name.
- [Flashlight project](https://github.com/bamlab/flashlight): Android tooling; do not assume the iOS host provides this workflow.
- [React Native DevTools](https://reactnative.dev/docs/react-native-devtools): distinguish its React/JS tracks from native system profiling and the custom Profiler API.
