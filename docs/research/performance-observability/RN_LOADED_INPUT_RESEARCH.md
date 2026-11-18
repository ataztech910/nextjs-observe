# Coordinate input during real native downloads

After merge #129 (`51cbff3`), follow the [ID/coordinate calibration](RN_INPUT_CALIBRATION.md).

Declared before acquisition, 18 November 2026 Europe/Vienna. The earlier ID pilot and idle calibration remain
separate protocols. This study tests whether the full-history→incremental change repeatedly lowers the declared
native touch-up→acknowledgement layout endpoint under equivalent loaded work. It is exploratory Simulator evidence,
not physical UX acceptance, a field p95 estimate, causal CPU attribution or exact 50-ms phase matching.

Nine fresh processes in three Latin-order blocks: idle→rescan→incremental; rescan→incremental→idle;
incremental→idle→rescan. Same existing Release/Hermes React profiling app artifact, no rebuild or app change.
History 8,192 rows; loaded runs request sixteen identical bodies, 128 source writes/body at 50 ms, retaining every
delivered progress/load callback and verifying every body after acquisition. Idle retains initial model, 137-ms
synthetic controls and 250-ms UI refresh but does zero download work; idle is not equivalent completed work.

All three measured taps use the calibrated 50%,33% portrait coordinate on the same Simulator/layout. Common start
uses ID. HTTP targets +3/+9/+15 s remain independent and frozen at source start; native timestamps, not gate release,
define input. No intermediate ack assertions. Keep the same 1,500-ms upper native-down lateness budget for all 27
gestures. Every native down/up/press and ack must validate inside acquisition; final Maestro proof requires ack3/Stored.
No excluded warmups: fresh process and all three gestures are included. No automatic/selective retry or exclusions.

Primary endpoint: per-process median of THREE native touch-up→ack-layout intervals. For each block, report
incremental-minus-rescan median lower/upper compatibility endpoints. Directional support requires all THREE paired
upper endpoints below zero, every phase budget met and matching loaded work: source body signatures/chunk counts,
per-file delivered callback counts, final jobs and summary. This is a descriptive repeat-direction rule, not a
significance test or a justified practical UX budget. If any pair disagrees, the declared repeated-benefit hypothesis
is not supported; do not replace it with a favorable percentile/slot or retune the case after seeing results.

Retain every individual point, paired median and per-slot difference to idle. Source/native clock compatibility
bounds also locate each actual native down relative to source file lifetimes and writes. Those describe observed
producer phases; matching coarse targets does not isolate 50-ms callback position or guarantee causal equivalence.
No post-hoc timestamp compensation. Touch-up→layout is not presentation/input-to-photon.

Independent report separates validation from hypothesis: phase miss or unequal work writes the full report and
exits 1; a valid measurement can exit 0 with hypothesis NOT supported. Unit/functional success never proves UX benefit.
Keep earlier failed sessions intact. Tests/builds/samplers run before/after, never during capture; OS-wide conditions
and native clock precision/drift remain uncontrolled. Preserve app/source hashes, raw bodies/events/gates, exact
flows/scripts, JUnit/commands/screenshots and analysis sources locally. Do not change title/abstract or old presentation.

Command: npm run research:rn-downloads -- <UUID> loaded; replay: node tools/loaded-input-report.mjs reports/<session>.
Observe/app instrumentation, harness orchestration/analysis, OTLP backend ingest/storage and Observer frontend
visualization remain separate. Raw pilot JSON is not a new Observer import format.


Setup recovery is retained separately: the initial version preflight had a missing temporary executable;
the next invocation failed foreground validation before source start/native gestures. Restore the same pinned
Maestro/Java releases with official checksum verification and prepare XCTest separately before the complete series.
Neither stopped invocation supplies a passing measurement; all raw failures remain retained. No app guard, budget,
endpoint or decision rule is relaxed for recovery.


## Completed series: measurement gate fails, hypothesis remains inconclusive

Session `li-1795028571253` completes all nine processes and 27 native gestures. All nine actual app/native/body/
idle checks and associated Maestro JUnit/commands validate. Six loaded runs retain 12,288 progress callbacks,
96 native loads and verified bodies, and 100,755,456 bytes. Every loaded source has 128 writes/body; per-file
callback populations, body signatures, final jobs and summaries match within each rescan/incremental pair.
Idle has zero download events/files/bytes and the unchanged initialized model.

**One of 27 gestures misses the unchanged 1,500-ms native-down lateness budget**: block 0 incremental, slot 1,
upper lateness 5,432.319 ms. All 27 observations remain retained without exclusions, point replacements or selective
retries. The complete report has `status: measurement-invalid`, `hypothesis: inconclusive`, `equivalentWork: true`,
`phaseBudgetMet: false`, and exits **1**. Passing functional JUnit is separate from measurement acceptance.

Individual milliseconds in planned slot order. Touch-up→layout values are lower endpoints of conditional native
clock compatibility; process medians show lower–upper compatibility endpoints; lateness values show upper endpoints.
They are neither accuracy guarantees, confidence intervals nor field percentiles.

| Block | Condition | Touch up→ack layout, 3 points | Process median interval | Native down lateness, 3 points | Phase budget met |
| --- | --- | --- | --- | --- | --- |
| 0 | idle | 21.881 / 15.891 / 11.098 | 15.891–15.910 | 360.403 / 365.201 / 338.089 | 3/3 |
| 0 | rescan | 10.178 / 9.582 / 14.590 | 10.178–10.198 | 323.858 / 407.495 / 337.273 | 3/3 |
| 0 | incremental | 4.807 / 16.953 / 9.889 | 9.889–9.910 | 5432.319 / 439.380 / 462.913 | 2/3 |
| 1 | rescan | 11.045 / 15.770 / 17.214 | 15.770–15.794 | 324.806 / 303.685 / 318.842 | 3/3 |
| 1 | incremental | 7.863 / 17.743 / 8.582 | 8.582–8.605 | 334.495 / 374.667 / 350.502 | 3/3 |
| 1 | idle | 19.448 / 20.962 / 12.129 | 19.448–19.470 | 329.772 / 359.729 / 351.847 | 3/3 |
| 2 | incremental | 14.586 / 16.529 / 15.141 | 15.141–15.167 | 330.237 / 330.722 / 347.166 | 3/3 |
| 2 | idle | 12.736 / 7.331 / 9.117 | 9.117–9.138 | 368.181 / 356.714 / 540.161 | 3/3 |
| 2 | rescan | 18.025 / 21.798 / 17.914 | 18.025–18.046 | 328.456 / 307.659 / 312.017 | 3/3 |

Primary paired differences, incremental minus rescan, milliseconds:

| Block | Lower endpoint | Upper endpoint | Equivalent loaded work |
| --- | --- | --- | --- |
| 0 | -0.308 | -0.268 | yes |
| 1 | -7.212 | -7.165 | yes |
| 2 | -2.905 | -2.858 | yes |

Every paired median interval is below zero in this sample. **That descriptive pattern does not override the failed
phase gate**; the declared hypothesis stays inconclusive. Do not claim a proven or practically meaningful UX win,
statistical significance, a field tail improvement or ordinary physical Release performance. The first pair's
small difference and all bounds remain subject to uncalibrated native clock accuracy/drift and uncontrolled OS
conditions. There is no post-hoc practical benefit threshold or new favorable metric.

### What the missed phase actually contains

The first incremental gate request arrived **5,092.452 ms after its target**, and was released 5,094.067 ms after
target. Native down followed release roughly 338 ms later under the conditional clock model. Much of the missed
target occurred BEFORE the HTTP gate request; it must not be called a 5.43-second app stall or native injection
latency. The responsible internal readiness/driver/host step is not isolated by this evidence.

At the first incremental press, JS had received 984 callbacks versus 391 for the first rescan press in that block.
The JSON retains actual native/source intervals, file identities and source writes before each event. Loaded
points have 6/6/4 definitely active source files across slots; identical active counts do not mean identical file
identities or callback phases. Even the other 26 within-budget gestures do not establish precise 50-ms matching.
No timestamp compensation or dropped outlier is used to repair the result.

## Artifact identity and verification

No app rebuild/source change: source SHA `443f3730c134d7136bc1644b76685c4d0ea3df379a26c501e325d1c7cd9c41d8`,
executable `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`, bundle
`ee5171a1c639fba0c629888cfdca50b92da2bbc599dc28db81645043c7d33640` match the previous pilot/calibration.
All 38 prepared-source manifest files validate; copied app and a 123-file hash inventory are retained.
This is the existing opt-in React profiling Simulator artifact, not ordinary physical Release acceptance.

Implementation is committed in the sibling local experiment repo at `128ec48` (no remote).
Raw evidence remains local/ignored at `performance-observability/reports/li-1795028571253/` in the workspace.
Report `loaded-input-study.json` SHA:
`d03084634370aaa60afcb028ad06eea6ce43bcdb75168532600e3b51b7aadbfc`.
Frozen protocol/tool copies, exact flows/gate scripts, clocks/native/source records, whole app, prepared source,
JUnit/commands/logs and per-flow screenshots remain retained. Both earlier setup failures are retained separately;
neither had native gestures or source acquisition start. The successful launch-only preparation is retained at
`reports/loaded-driver-preflight/`, outside the study's measurement sample.

Restored official releases are checksum-verified: Maestro 2.12.1 zip
`54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7`; Temurin 21.0.13+9 archive
`bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a`. Version/release checksums are retained;
restoration did not change app code, foreground guard, endpoint, budget, order or decision rule.

**146 JS tests pass**. Source mutations accepting only some favorable pairs, ignoring work mismatch and omitting
the native clock conversion fail; restored source passes. No new Python tests or dependencies. The actual existing
JUnit parser independently validates every flow during replay. Tests/builds/samplers did not run alongside measured
capture; OS-wide conditions remain uncontrolled. Simulator was returned to its manual Release screen.

An isolated archive `/private/tmp/loaded-input-export-hlimcw72/analysis.tgz`, unpacked outside both repositories,
regenerates the same report SHA without npm dependencies and has expected exit 1. Disabling the failure exit,
substituting a foreign JUnit flow or changing the recorded coordinate fails the corresponding check; restored
inputs replay identically. The earlier paced and ID/coordinate reports also replay to their original hashes and
expected failure statuses. All 276 original-presentation file hashes remain unchanged; fixed title/abstract and
F evidence index are untouched. No Observer importer, runtime package or OTLP contract changes are introduced.

## Decision

Retain this as an **unaccepted exploratory input comparison**, with its favorable descriptive median pattern and
failed validity gate both visible. It cannot satisfy the conference's RN before/after UX requirement. Do not repeat
selected points, weaken the budget or keep tuning this case until it produces a desired story. Further input work
would need a separately declared readiness/barrier design and independent evidence, not a rewrite of these results.
For the next conference experiment, move to the still-open startup/SSR hydration coverage. Hermes full-history
attribution remains separate diagnostic evidence. Physical presentation, ordinary Release, React Components
Profiler, Flashlight and an executable regression rule remain open under the fixed brief.
