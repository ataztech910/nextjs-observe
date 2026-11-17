# Native input delivery: ID selector versus coordinate

17 November 2026. Follow-up after #128 (`2281d98`), whose [paced input pilot](RN_PACED_INPUT_RESEARCH.md)
missed its phase budget. This is delivery calibration without downloads, not a new app optimization benchmark.

## Frozen protocol

Eight fresh processes in four paired blocks: id→point, point→id, id→point, point→id. Three native gestures per
process; all 24 planned gestures and any failures remain retained. Both routes use the same existing Release/Hermes
React profiling Simulator artifact, 8,192-row rescan initial model, 137-ms synthetic controls, 250-ms display refresh
and zero downloads. No app source, instrumentation or build is changed for the route comparison.

Independent HTTP gates target +3/+9/+15 seconds from source start. The existing conditional native-down lateness
upper budget stays 1,500 ms. No intermediate acknowledgement assertions, automatic retries or selected reruns.
ID targets `pilot-action`; the coordinate route targets `50%,33%` of the portrait screen, chosen from the retained
1206×2622 idle screenshot of the same app/device. The common start button still uses ID. Each hit must produce
the app's native down/up/press sequence and acknowledgement layout; final Maestro assertions require ack 3/Stored.

Maestro's [tapOn reference](https://docs.maestro.dev/reference/commands-available/tapon) supports coordinates and
describes settling timeouts as best effort. Zero settling timeout does not guarantee immediate injection.
The coordinate is device/layout specific and cannot be generalized to a different screen or physical device.

Each route passes only if all twelve native-down events meet the unchanged budget. The overall report exits 1
if either route fails, retaining both routes and every point. Per-block/per-slot point-minus-id lateness intervals
use conditional source/native clock compatibility; they are not confidence intervals. Neither a passing budget
nor a faster route demonstrates exact 50-ms callback-phase alignment or an app UX improvement.

The local experiment command is `npm run research:rn-downloads -- <SIMULATOR_UUID> calibration`; independent replay
is `node tools/input-calibration-report.mjs reports/<session>`. Raw app/source/gates/native events, clock samples,
flows, scripts, JUnit/commands and screenshots remain local/ignored. Observe/app adapters own instrumentation;
the harness owns delivery and analysis, the actual OTLP backend owns ingest/storage, and Observer frontend owns
supported visualizations. This is not a new Observer importer or runtime package change.


## Completed calibration

Session `input-cal-1794955881697` completes all eight processes and 24 native gestures. Every associated Maestro
JUnit/command proof passes; all receipts validate real native down/up/press, ack-layout, zero download events/files/
bytes and the unchanged initial store. There are no automatic retries, exclusions or selected replacement runs.

Coordinate delivery meets the unchanged budget for **12/12** gestures. ID meets it for **9/12**, missing one gesture
in each of blocks 1, 2 and 3. Overall status remains **`phase-budget-missed`** and the CLI saves the complete report
then exits **1**. A passing coordinate route is not used to relabel the two-route calibration as wholly passing.

All individual points, milliseconds. Lateness is the upper endpoint of conditional source/native clock compatibility;
touch-up→ack layout is the lower endpoint of the native clock interval. Neither is a confidence interval or field
percentile. All points, including the three ID misses, remain shown.

| Block | Route | Native down lateness, 3 points | Touch up→ack layout, 3 points | Phase budget met |
| --- | --- | --- | --- | --- |
| 0 | id | 1085.745 / 872.263 / 731.112 | 10.759 / 5.874 / 13.731 | 3/3 |
| 0 | point | 406.859 / 377.463 / 348.160 | 18.966 / 13.632 / 10.664 | 3/3 |
| 1 | point | 357.059 / 360.269 / 362.506 | 9.787 / 6.077 / 20.706 | 3/3 |
| 1 | id | 1102.759 / 1104.739 / 1603.755 | 13.130 / 10.970 / 12.336 | 2/3 |
| 2 | id | 1275.339 / 569.775 / 2181.908 | 23.096 / 11.443 / 16.018 | 2/3 |
| 2 | point | 396.669 / 335.531 / 371.201 | 19.742 / 13.962 / 11.851 | 3/3 |
| 3 | point | 351.170 / 320.780 / 341.457 | 14.127 / 10.895 / 6.728 | 3/3 |
| 3 | id | 3635.295 / 727.321 / 1100.190 | 11.571 / 20.306 / 13.647 | 2/3 |

Coordinate lateness upper endpoints span **320.780–406.859 ms**, ID **569.775–3635.295 ms**. Every one of the twelve
per-block/per-slot point-minus-ID lateness compatibility intervals lies below zero; all are retained in the JSON.
These are descriptive observations under the declared balanced order, not statistical significance, a portable
accuracy guarantee or source-level proof of which internal Maestro operation caused the difference. The ID path
includes selector lookup, but this experiment does not separately time lookup versus the other driver operations.

Native touch-up→ack-layout lower endpoints overlap: ID **5.874–23.096 ms**, coordinate **6.077–20.706 ms**.
The delivery result is not an app optimization or a faster application input path. Planned host gates are never
substituted for UITouch event time. Even 321–407 ms is several 50-ms write intervals: the 1,500-ms budget is coarse
coverage, not exact callback-phase matching. No loaded rescan/incremental input comparison has been accepted here.

## Identity, replay and limitations

The app was not rebuilt: source `443f3730c134d7136bc1644b76685c4d0ea3df379a26c501e325d1c7cd9c41d8`, executable
`1b61f80775a90b3d755fa68cbfce6b7c56c44a29a87e35882002ffe1f6d76ea5`, bundle
`ee5171a1c639fba0c629888cfdca50b92da2bbc599dc28db81645043c7d33640` match the previous paced pilot. Prepared source
bodies validate against the source manifest before capture. The copied whole app has a retained 123-file hash
inventory. This remains a Release/Hermes **React profiling Simulator** artifact, not ordinary physical Release.

Implementation is committed in sibling local experiment repo at `d3fdab0` (no remote).
Raw evidence remains local/ignored at `performance-observability/reports/input-cal-1794955881697/` in the workspace.
Report `input-calibration-study.json` SHA:
`676c950c9ecdddd55061553667ea38f2b54b70c455425de9023f8945ce0333bd`.

After observing the actual Maestro export, the offline validator's coordinate command key was corrected to
`tapOnPointV2Command` (the initially assumed key omitted `Command`). Protocol, acquisition, app and raw exports were
not changed or rerun. The original acquisition source copies remain retained; `post-analysis-source/` holds the
corrected validator/report/test. Actual commands now verify the exact point, route, zero settling timeout, disabled
retry/repeat, completed taps, common start and final acknowledgements. Wrong route/point, missing/skipped/retried taps
and an extra legacy coordinate command are rejected.

Verification: **143 JS tests** pass after the correction; the existing Python suite passes 9 tests, including the
same 3 Maestro JUnit parser tests (no new Python tests). Wrong-route, wrong-coordinate and unconditional-acceptance
source mutations fail; restored tests pass. The first full JS invocation was blocked by sandbox localhost EPERM and
is not counted as passing; the complete rerun with localhost allowed passes. Tests/builds/samplers did not run
alongside acquisition. OS-wide background/power conditions were not controlled; clock precision/drift remain
uncalibrated. Simulator was returned to the normal manual Release screen.

Isolated artifact `/private/tmp/input-calibration-export-_wrc1pdt/analysis.tgz`, unpacked outside both repositories,
recreates the same report hash using Node/Python stdlib without npm dependencies and has expected exit 1.
Disabling that exit, changing the exported coordinate, or substituting a foreign JUnit flow fails the respective
check; restored evidence reproduces the report. The earlier paced report also replays to its unchanged SHA and expected exit 1.
All 276 original-presentation file hashes remain unchanged. Fixed title/abstract and F evidence index are unchanged.

## Next decision

Use the coordinate route as a candidate in a separately declared **loaded** study, preserving all callbacks/body
verification and reporting actual native event phases. Do not pool this idle calibration with the earlier loaded
pilot, compensate timestamps post hoc, or claim precise 50-ms phase alignment. If exact phase alignment is required,
calibrate a lower-level injection route separately. Physical presentation, ordinary Release, React Components
Profiler, startup/hydration, Flashlight and an executable regression rule remain open under the fixed brief.
