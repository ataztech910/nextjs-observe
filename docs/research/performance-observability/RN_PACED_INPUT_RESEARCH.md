# Paced native input with a no-download control

17 November 2026. After merge #127 (`5ce01e7`), extend the [native input gate](RN_NATIVE_INPUT_RESEARCH.md).
This is an exploratory Release/Hermes React profiling Simulator pilot, not ordinary physical Release acceptance,
a field p95 benchmark or causal CPU/GC evidence. Fixed title/abstract and original presentation remain unchanged.

## Declared comparison

Three conditions: `idle` (no downloads), full-history `rescan`, and `incremental`. Idle retains the same initialized
8,192-row model, synthetic control notifications every 137 ms and display refresh every 250 ms; it is not an empty
screen or zero-instrumentation baseline. Loaded conditions preserve all sixteen deterministic bodies/bytes,
128 writes/body every 50 ms, every delivered callback and the same final state. Idle intentionally does no transfer
work; it is a control for the background producer, not equivalent completed downloads or a new optimization.

Before acquisition, freeze three Latin-order blocks: idle→rescan→incremental, rescan→incremental→idle,
incremental→idle→rescan. Nine fresh app processes; each condition occupies every order position once. Three gestures
per process, 27 total. Order balancing does not control OS-wide power/background activity or establish significance.

The external source freezes targets +3,000/+9,000/+15,000 ms on start. Maestro `runScript` HTTP gates wait for those
absolute deadlines, then native taps proceed **without intermediate ack assertions**. A slow prior action cannot
move the next deadline. No busy loop, synthetic JS input, discarded slow point or automatic retry is introduced.

Actual injection remains a measured variable: source request/release timestamps, native down/up and JS receipt/ack
timestamps are all retained. Native-down lateness combines native↔JS and source↔JS compatibility bounds. Predeclare
an upper bound of 1,500 ms for phase coverage; retain every point and report failure if missed. A missed phase does
not become an exclusion or a favorable reschedule. Native clock precision/drift/injection accuracy remain uncalibrated.

Maestro documents [`waitToSettleTimeoutMs`](https://docs.maestro.dev/reference/commands-available/tapon) as best effort,
so setting it to zero does not guarantee immediate injection. The [runScript workflow](https://docs.maestro.dev/reference/commands-available/runscript)
executes the generated gate scripts; planned release is never substituted for native event time or app latency.

## Implementation and evidence contract

The app-local host reuses the native touch recorder and ack-layout endpoint. The idle branch explicitly opens a
20-second window without calling XHR. Timestamp/UI instrumentation otherwise remains the same. The harness checks
prepared source bodies against the build manifest before installing/running and retains matching bodies. Idle data
must have zero download events/files and an unchanged initial store; it cannot enter the default download validator
or silently substitute for missing loaded evidence.

`npm run research:rn-downloads -- <SIMULATOR_UUID> paced` runs the declared blocks using the existing Maestro/Java
setup. `node tools/paced-input-report.mjs reports/<session>` replays every app/control/body/input check, associated
JUnit/runner exit and exact non-optional tap/assertion sequence. It retains all planned/actual phases and reports
per-block/per-slot differences from idle with clock compatibility bounds, not confidence intervals. No pooled field
percentiles or extrapolation to physical devices is supported.

The experiment implementation remains in the sibling local repository (no remote); the workshop journal pins its
commit. Raw app, source bodies, HTTP gate/flow scripts, native events, source receipts, JUnit/commands/logs/screenshots
and report input hashes stay local/ignored. Observe/app adapters own instrumentation, the harness owns orchestration
and comparisons, the actual backend owns OTLP ingest/storage and Observer frontend owns supported display. This
research JSON is not a new Observer importer; no backend/frontend runtime package changes are required.


## Completed pilot: phase coverage failed

Session `paced-input-1794954728629` completed all nine fresh processes and 27 native gestures, with successful
associated Maestro JUnit/commands and valid native input/body/model evidence. **The declared phase gate failed**:
4/27 gestures exceeded the 1,500-ms native-down lateness budget, across three processes. All points remain retained;
there are no selective retries, exclusions or accepted phase-matched benchmark claims. The report status is
`phase-budget-missed`; the CLI saves the full report and exits **1**, independently of passing JUnit.

The six loaded runs preserve 12,288 observed progress callbacks, 96 native loads/verified bodies and 100,755,456 bytes.
The three no-download controls have zero download events/files/bytes and preserve the initial model. Every loaded
run retains all delivered callbacks and matches its reconstructed final state. No work-equivalence claim is made
between idle and loaded conditions. No tests/builds/sampler ran alongside acquisition; OS-wide conditions were not
controlled. Simulator was returned to its manual Release screen.

Individual values in slot order, milliseconds. Touch-up→layout values below are lower endpoints of conditional
native clock intervals; lateness values are upper endpoints combining source/native clock compatibility bounds.
They are not percentiles, exact timestamp accuracy or confidence intervals.

| Block | Condition | Touch up→ack layout, 3 points | Native down lateness, 3 points | Phase budget met |
| --- | --- | --- | --- | --- |
| 0 | idle | 13.349 / 20.484 / 16.798 | 1222.335 / 1479.712 / 1484.239 | 3/3 |
| 0 | rescan | 15.838 / 32.595 / 21.906 | 515.987 / 894.579 / 705.476 | 3/3 |
| 0 | incremental | 15.909 / 12.217 / 18.797 | 1329.829 / 734.865 / 711.763 | 3/3 |
| 1 | rescan | 36.119 / 40.891 / 16.269 | 607.336 / 753.131 / 2593.910 | 2/3 |
| 1 | incremental | 17.702 / 8.603 / 7.873 | 880.821 / 1390.861 / 926.472 | 3/3 |
| 1 | idle | 8.252 / 18.659 / 18.927 | 537.399 / 1477.902 / 1093.995 | 3/3 |
| 2 | incremental | 17.996 / 7.566 / 8.707 | 928.621 / 1672.933 / 903.606 | 2/3 |
| 2 | idle | 14.168 / 8.701 / 21.794 | 1100.034 / 1471.734 / 541.816 | 3/3 |
| 2 | rescan | 8.590 / 24.456 / 10.984 | 1842.967 / 1077.417 / 2404.029 | 1/3 |

Idle touch-up→layout lower endpoints span 8.252–21.794 ms; rescan 8.590–40.891 ms; incremental 7.566–18.797 ms.
These are descriptive extrema of nine observations per condition, not p95 or estimates of production behavior.
The no-download control demonstrates that a measurable input path exists without transfer-history work. Rescan
has larger individual observations here, but differences against idle have mixed signs and phase alignment failed;
**this does not establish a causal or reliable native-input optimization win**.

Observed native-down lateness spans roughly 0.516–2.594 seconds. This is gate-to-injection timing, not app response
latency. `waitToSettleTimeoutMs: 0` did not remove Maestro core-operation delay. Never turn those seconds into an app
stall or use the gate timestamp instead of UITouch time. Fixed deadlines were preserved even when missed; actual
native events and background callback positions remain visible. The 1,500-ms budget is broad relative to 50-ms
writes and does not establish exact callback-phase matching even for the 23 within-budget gestures.

The report retains all per-block/per-slot contrasts against idle, each with both phase flags and conditional clock
bounds. No favorable subset or pooled percentile is presented. Native pipeline waiting, JS scheduling, CPU/GC and
power effects remain unseparated; layout effect is neither paint nor input-to-photon.

## Artifact identity and verification

- App source SHA: `443f3730c134d7136bc1644b76685c4d0ea3df379a26c501e325d1c7cd9c41d8`.
- Native executable SHA: `1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`.
- Release bundle SHA: `ee5171a1c639fba0c629888cfdca50b92da2bbc599dc28db81645043c7d33640`.
- `paced-input-study.json` SHA: `bad70b0f9ad6bb21add098722286be1fd867dcac48126d267ada3a7ce81f9c1e`.

Evidence is local/ignored at `performance-observability/reports/paced-input-1794954728629/` in the workspace.
It includes the whole app/file hashes, matching prepared source bodies, installed RN touch/clock paths, frozen
protocol and source copies, raw controls/body/input/gate records, concrete flows and gate scripts, JUnit/commands/
logs/per-flow screenshots and report input hashes. The archived pre-acquisition prose has a one-day calendar typo;
current documentation corrects it to 17 November, while the original snapshot and actual session timestamps remain
untouched. No protocol parameters or collected values were changed for that correction.

Checks: 141 JS tests + 3 Python tests; actual native Release build. Source mutations retargeting deadlines from
current time, ignoring the phase budget, or allowing events in idle fail; restored source passes. Deadline tests
also cover early timer rearming and cancellation, with a bounded timeout. An early mutation caused an unresolved
fake-timer wait; it was stopped, an assertion before await and bounded test were added, and clean mutations/suite
then passed before acquisition. No interrupted suite is counted as successful verification.

All nine paced analyses, eight earlier input analyses and sixteen prior notification analyses replay identically.
An isolated unpacked analysis artifact regenerates the same report SHA with Node/Python stdlib and no npm installs:
`/private/tmp/paced-input-export-9pz7l8yq/analysis.tgz`. Its expected exit is 1 for the missed budget; disabling that exit
guard fails the exit check. A foreign JUnit flow is rejected separately; restored evidence replays identically.
All 276 original-presentation file hashes remain unchanged. This is a local experiment implementation/documentation
checkpoint, not a new runtime package, OTLP signal or Observer import format.

## Next measurement decision

Follow-up: [ID/coordinate calibration](RN_INPUT_CALIBRATION.md) retains all 24 no-download gestures; coordinate
meets the unchanged budget for 12/12, ID for 9/12. This identifies a candidate route, not a replacement for this
failed loaded pilot or proof of precise callback-phase matching. A separate loaded study remains necessary.

Validate a lower-jitter injection route before accepting a phase-controlled input benchmark; coordinate selection
or a different driver needs its own predeclared calibration, not a retrospective relaxation of this budget.
Retain this no-download baseline and every failed phase. Physical ordinary Release/presentation, React Components
Profiler, startup, SSR hydration, Flashlight and an executable CI regression rule remain open under the fixed brief.
