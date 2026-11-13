# Maestro → native app evidence → Observer

The separate `performance-observability` experiment repo adds a Maestro Simulator producer for the scenario report
reader merged in PR #101. Observer runtime, Observe public API and receiver/storage implementation do not change.
App-local host changes are limited to optional validated protocol association and stable accessibility IDs/status.
Existing instrumentation, selected workload, native callback sensor and source-clock qualifications are preserved.

From that repository, with an available booted Simulator and rebuilt Release host:

```sh
JAVA_HOME=/path/to/jdk/Contents/Home \
MAESTRO_BIN=/path/to/maestro/bin/maestro \
OBSERVER_PACKAGE_ROOT=/path/to/merged/packed-observer/package \
npm run scenario:ios -- --device <simulator-uuid>
```

Append `--expect-completion 'Impossible completion marker'` for a real negative acceptance run. It executes the
workload, then fails a UI assertion; finalized capture is preserved but the scenario is failed and exits 1.
Full setup, artifact inventory and toolchain hashes live in experiment `MAESTRO.md`.

The orchestration process owns temporary receiver/storage and a loopback receipt server. It installs/launches one
fresh process with Simulator-only config and autoRun disabled. Maestro preserves that config with `stopApp:false`,
asserts the requested run ID and triggers the actual button. The original native/JS workload supplies measurements;
Maestro action durations are never turned into application CPU, frame or touch latency.

The adapter validates single-flow JUnit counts/status/run property; empty/skipped runs and unknown identities cannot pass.
It consumes command JSON through the original versioned artifact manifest, requiring completed matching app/run
configuration, button tap and completion assertion. Receipt/capture/source/protocol/variant/mode and expected 2-span /
4-metric-point diagnostic populations must agree. Native samples and pre/post clock pairs are independently
re-analyzed; foreign session, dropped observations or altered summary fail. Identical concurrent receipt retries
share one persistence operation; conflicting payloads are rejected and disk failures stay failures.

Every session preserves normalized JSON and original JUnit/commands/manifests, Maestro logs/screenshots/failure
hierarchy, app receipt/raw OTLP, native app, prepared source manifest and matching file bodies, source/build inventory,
backend fingerprint and browser verification/screenshot. Large native app/logs remain local; the existing bounded
reader imports structured references. No external HTML/code execution or upload API was added.

Observed Maestro `cli-2.12.1` leaves `${RUN_ID}` literally in JUnit properties. The first real flow passed but the
strict adapter correctly produced incomplete. The runner now generates a concrete flow with a literal run ID,
retaining both template and concrete body; checks were not weakened to accept placeholders. A mutation test for
receipt conflicts initially waited on its own unreleased gate; that test was fixed, mutations restored, and final
runs were repeated separately after mutation checks ended. Intermediate pilot sessions are not final acceptance.

Maestro and Temurin Java 21 were downloaded from official release endpoints to `/private/tmp`, with archive hash
checks and scoped environment variables. No global PATH/JVM selection changed, no new npm dependencies. Maestro
uses its normal local Simulator XCTest driver/cache. This driver is not a hitch/presentation measurement.

Native hitches remain unavailable; clock precision/drift remain unknown. This increment establishes runner/result
integration on Simulator. It does not close conference D/E/F, physical-device, repeated-statistics or overhead gates.
Next: repeated matched web/native protocols, then the remaining platform-specific measurement gates.

Sources: [Maestro reports/artifact manifests](https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts),
[launchApp](https://docs.maestro.dev/reference/commands-available/launchapp).
