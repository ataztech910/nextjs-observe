# next-observe — working notes for Claude

OpenTelemetry observability for Next.js with AI agents that investigate on their own. Reference implementation for the
workshop "AI-Native Observability" (Porto, 10 Nov 2026).

**Start here:** `docs/WORKSHOP_LOG.md` (every step: what, why, how it was tested, what we learned; "Дальше" = backlog)
and `docs/WORKSHOP_PLAN.md` (the 3.5 h workshop). The log is written in Russian; code, comments and commits in English.

## Layout

```
packages/next-observe/   goes INTO the app — OpenTelemetry only, no AI dependencies
  src/config.ts          withObserve(nextConfig): 'use observe' loader rule, /__observe proxy rewrite, service name env
  src/server.ts          register() for instrumentation.ts (@vercel/otel, OTLP/JSON)
  src/client.ts          browser OTel for instrumentation-client.ts
  src/runtime.ts         __observe.run() used by transformed code
  src/transform/         Babel plugin + Turbopack loader for 'use observe'
  src/agents.ts          defineSpecialist() + types for the app's observe.agents.ts (no ADK; next-observer validates and runs it)
  e2e/observe-page.mjs   instrumentation checks against a running observer
packages/next-observer/            the observer, run with `npx next-observer dev` — never an app dependency
  src/collector/         OTLP/JSON ingest, MemoryStorage, query API, chat transport (NDJSON + SSE), static UI
  src/debug/             agent tools as pure functions (queries.ts), anomaly detector, demo data — no ADK imports
  src/checks/            scheduled checks from the app's observe.checks.ts: validation (spec.ts) and the runner
  src/agents/            ADK agents (@google/adk, @kitana-sdk/adk are regular deps), MockLlm, chat handler, evidence
                         cards; specialists.ts = specialists as data (built-ins + the app's observe.agents.ts)
  src/cli.ts, bin.ts     next-observer dev | next-observer collector [--demo]
  ui/                    Vite + React SPA (TanStack Router/Query, shadcn/ui, Tailwind 4), built into dist/ui
  test/                  vitest unit tests; test/fixtures/shop.ts = workshop scenario at a fixed clock
  e2e/                   investigate.real.test.ts (real model), traffic.mjs, agent-tools.mjs
spikes/adk-kitana/       ADK + Kitana spikes (workshop agent cases)
```

## Commands (in packages/next-observe or packages/next-observer)

```bash
npm test                     # unit tests (real-model e2e is skipped unless OBSERVE_AI=real)
npm run typecheck            # package (+ ui in next-observer)
npm run build                # tsc (+ vite → dist/ui in next-observer)
npm pack --pack-destination ..            # the artifact users get
OBSERVE_AI=real npx vitest run e2e/investigate.real.test.ts --testTimeout=300000 --silent=false   # next-observer
node e2e/traffic.mjs healthy 15 failing 25   # next-observer: live traffic for the detector
```

End-to-end like a participant: install the packed `next-observe` tarball into a copy of the app (no ADK in the app),
run the observer with `npx --yes --package=<next-observer tarball> next-observer dev`. Test bench: `../vercel-otel-test`; workshop app:
`../workshop-ai-observability` (Porto Shop).

## Words

Two different things are called "agent" — always say which:

- **APM agent** = `next-observe`, the library inside the app that collects and sends telemetry. No AI in it.
- **AI agents** = the ADK agents inside `next-observer` (orchestrator + specialists). They never run in the app.
- **observer** = `next-observer` as a whole: the server (collector), the UI, the detector and the AI agents.

In docs, READMEs and UI text never write a bare "agent(s)" where a reader could take it for the other kind.

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
