# next-observe — working notes for Claude

OpenTelemetry observability for Next.js with AI agents that investigate on their own. Reference implementation for the
workshop "AI-Native Observability" (Porto, 10 Nov 2026).

**Start here:** `docs/WORKSHOP_LOG.md` (every step: what, why, how it was tested, what we learned; "Дальше" = backlog)
and `docs/WORKSHOP_PLAN.md` (the 3.5 h workshop). The log is written in Russian; code, comments and commits in English.

## Layout

```
packages/next-observe/
  src/config.ts          withObserve(nextConfig): 'use observe' loader rule, /__observe proxy rewrite, service name env
  src/server.ts          register() for instrumentation.ts (@vercel/otel, OTLP/JSON)
  src/client.ts          browser OTel for instrumentation-client.ts
  src/runtime.ts         __observe.run() used by transformed code
  src/transform/         Babel plugin + Turbopack loader for 'use observe'
  src/collector/         OTLP/JSON ingest, MemoryStorage, query API, chat transport (NDJSON + SSE), static UI
  src/debug/             agent tools as pure functions (queries.ts), anomaly detector, demo data — no ADK imports
  src/agents/            ADK agents (optional peer @google/adk, @kitana-sdk/adk), MockLlm, chat handler, evidence cards;
                         specialists.ts = specialists as data (built-ins + project observe.agents.ts, loaded by the CLI)
  src/cli.ts, bin.ts     nxo dev | nxo collector [--demo]
  ui/                    Vite + React SPA (TanStack Router/Query, shadcn/ui, Tailwind 4), built into dist/ui
  test/                  vitest unit tests; test/fixtures/shop.ts = workshop scenario at a fixed clock
  e2e/                   observe-page.mjs (API checks), investigate.real.test.ts (real model), traffic.mjs, agent-tools.mjs
spikes/adk-kitana/       ADK + Kitana spikes (workshop agent cases)
```

## Commands (in packages/next-observe)

```bash
npm test                     # unit tests (real-model e2e is skipped unless OBSERVE_AI=real)
npm run typecheck            # package + ui
npm run build                # tsc + vite → dist (incl. dist/ui)
npm pack --pack-destination ..            # the artifact users get
OBSERVE_AI=real npx vitest run e2e/investigate.real.test.ts --testTimeout=300000 --silent=false
node e2e/traffic.mjs healthy 15 failing 25   # live traffic for the detector
```

End-to-end target app: `../vercel-otel-test` (install the packed tarball there, run `node_modules/.bin/nxo dev --root .`).

## How we work

- **Minimal steps**, one at a time; each ends with: unit tests, **mutation check** (break the fix on purpose, the test
  must fail — a test that also passes on the old code proves nothing), and an **e2e run on the packed tarball** in a real
  app/browser. Log the step in `docs/WORKSHOP_LOG.md` (and update "Дальше").
- Concurrency (locks, queues, timeouts, SSE) needs its own tests — the review hook caught races here twice.
- Agents: facts only from tools; evidence cards are built by code from tool results, never by the model. Tool outputs
  stay compact (aggregates), name filters are case-insensitive and fall back with a `note` instead of returning empty.
- `OBSERVE_AI=mock` (default) runs the whole agent pipeline without tokens; use `real` only for evals.

## Git

- One branch per step from fresh `master` (`step-N-...`); the user merges PRs. Push only the step branch.
- Hooks: pre-commit runs an AI review and may block — fix the findings, never `--no-verify` on your own; pre-push blocks
  pushes to `master`. If a hook moves a commit to another branch, stop and adapt.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Kitana (the user's package, ../../../kitana/_sdk/kitana)

- Publish only with `pnpm publish` from `packages/<name>` — `workspace:` ranges break `npm publish` (0.1.8/0.1.9 were).
- Verify a release on the packed tarball against the previous version with the real CLI before publishing.
- The tool protocol prompt must say the functions are a text protocol, not the model's native tools (`claude -p` is an
  agent with its own tools).
