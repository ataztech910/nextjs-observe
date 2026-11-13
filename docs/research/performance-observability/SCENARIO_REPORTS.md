# Runner-neutral scenario reports

A scenario runner performs actions; app instrumentation and independent measurement tools supply performance
observations. Observe exports OTLP; the receiver/storage owns capture/replay; Observer displays typed reports.
No Maestro/Playwright instrumentation or scenario execution is added to Observer.

## Contract

The existing `observe.performance-report/v1` comparison format and exported `PerformanceReport` type are retained.
`ExperimentReport` is the union of that format and `ScenarioReport` (`observe.scenario-report/v1`). Both use the
existing authenticated `/api/performance/reports` endpoints and optional report directory.

A scenario report has `id`, `title`, `endpoint`, `runner` (`playwright` or `maestro`), `protocol` (name/SHA-256),
`limitations` and `runs`. Each run contains:

- `runId`, `variant`, `mode`, matching the archived capture and its `protocol.sha256` label.
- `manifestFile`: `finalized.json` or `run.json`, and `manifestSha256` of that exact file.
- `status`: `passed`, `failed` or `incomplete`.
- `checks`: named statuses with textual details. Any failed check makes the run failed; otherwise any incomplete
  check makes it incomplete; otherwise it passes. Passed runs require a finalized capture without incomplete reasons.
- `measurements`: named finite values with units/source, or `value: null` and a nonempty `unavailableReason`.
  A real zero remains zero. Runner click/wait duration must not be relabeled application CPU, paint or input latency.
- `artifacts`: name/SHA-256 references to original result, samples, diagnostics or screenshots.

The backend checks schema, status consistency, artifact and manifest hashes, raw OTLP archive integrity, and capture
association. It does not recompute external measurements or establish a producer's authenticity. Draft captures may
be shown for failed/incomplete scenarios. A report referring to a draft becomes stale if that capture is subsequently
finalized; use a new immutable report/version rather than silently changing the association.

Artifacts live at `<report-dir>/artifacts/<sha256>`; a report lives at `<report-dir>/<id>.json`. Names are display
labels, never filesystem paths supplied to the reader. Existing 8 MiB/file, 64 MiB aggregate artifact and 100-report
listing limits apply; a scenario allows at most 100 runs, 100 checks/measurements/artifacts per run. Large native
profiler files need a future bounded attachment facility; they cannot simply bypass these limits. UI renders typed
text and measurements, with capture links and artifact hash references. Arbitrary HTML/log viewers, uploads,
attachment downloads and scenario scheduling are not part of this increment.

## First producer: React Web / Playwright

The separate local `performance-observability` repository provides:

```sh
npm run build
OBSERVER_PACKAGE_ROOT=/absolute/path/to/extracted/next-observer/package npm run scenario:web
# Negative acceptance check: produces failed in JSON/UI and exits 1.
OBSERVER_PACKAGE_ROOT=/absolute/path/to/extracted/next-observer/package npm run scenario:web -- --expect-first 0
```

Use Node 24 and an installed Chrome (`--channel` selects a different installed Playwright channel). This is a
Playwright-library scenario runner with a custom result adapter, not the Playwright Test JSON reporter.
It uses the existing production-profiling app: baseline/diagnostic, three actual button-triggered commits, no warmup
exclusion. It checks downloaded run/protocol identity, deterministic outputs, page errors, finalization and expected
6-span/3-metric-point population. It records each app-owned handler-to-Profiler-callback duration without deriving
performance from runner action time. Presentation remains explicitly unavailable.

Every unique `reports/web-scenario-*/` directory preserves:

```text
protocol.json                  scenario, runner/browser/OS, backend fingerprint, source checkout identity
result.json                    normalized checks/measurements/status and page errors
samples.json                   original app download (completed scenarios)
source-index.json              hashes of retained source/build snapshots
source/, build/                exact web source/locks/tools and built app
captures/<runId>/              existing run.json/finalized.json and raw OTLP
playwright-trace.zip, app.png   diagnostic artifacts
observer-reports/<id>.json     runner-neutral presentation report
observer-reports/artifacts/    hash-addressed original artifact bytes
observer.png                   actual Observer browser screenshot
ui-verification.json           displayed status and unavailable-state check
```

Pre-capture/environment failures preserve `runner-error.json` but cannot produce a report claiming a verified
capture association. The runner closes its browser and temporary servers, writes incomplete diagnostics on runtime
failure, and exits nonzero for failed/incomplete results. App page errors and Observer page errors are checked.
The protocol includes source HEAD/dirty state; exact snapshots, rather than the HEAD label alone, identify dirty runs.

To inspect a saved session with the new backend (from the experiment repo):

```sh
OBSERVER_PACKAGE_ROOT=/absolute/path/to/extracted/package \
CAPTURE_DIR=reports/<session>/captures \
PERFORMANCE_REPORT_DIR=reports/<session>/observer-reports \
OBSERVE_PORT=4322 npm run collector
```

Open `/performance?report=<session>&run=<session>` on that collector. The original native collector can stay separate.
The web scenario is a functional acceptance check with diagnostic tracing enabled, not repeated performance,
overhead, physical-device or conference acceptance evidence. Archived earlier experiment sessions remain untouched.

## Maestro producer

The sibling experiment repository now supplies a real `maestro/cadence.yaml` flow and `npm run scenario:ios`.
It installs/launches a fresh Simulator Release process with `autoRun:false`; Maestro brings it forward, checks run
identity, taps the workload button and asserts completion. The external adapter preserves raw JUnit, command
artifacts, screenshots/logs, app receipt, source/native app and OTLP capture, then uses the unchanged scenario-report
reader. Completed tap/assertion evidence is required independently of JUnit/exit status.

The observed Maestro 2.12.1 exporter leaves environment placeholders literal in JUnit properties, so the orchestrator
writes a concrete flow with the actual run ID before launch. Run attribution remains strict. An actual failed UI
assertion produces failed JUnit/JSON/UI and nonzero exit despite finalized telemetry. No Observer runtime extension
was needed for this producer. See [Maestro gate and validation](MAESTRO_GATE.md).

This remains Simulator functional evidence. Native hitches/presentation require a supported measurement source;
a passed UI flow or use of Maestro's XCTest driver does not establish native smoothness or measure XCTHitchMetric.
