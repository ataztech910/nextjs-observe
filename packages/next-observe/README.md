# next-observe

OpenTelemetry observability for Next.js 16 — with AI agents that investigate problems on their own.

- **Server** traces via `@vercel/otel`, **browser** traces (document load, fetch, React renders), and **your own code**
  with a `'use observe'` directive
- A local **collector** with a trace UI (list + waterfall) — no Docker, no external backend
- **Chat with agents** (Google ADK) that query your telemetry: slow operations, regressions between deployments,
  failing operations with exact errors, N+1 patterns — with evidence cards built from the data, not by the model
- An **anomaly detector** that starts an investigation by itself when error rates or latency jump

> Reference implementation for the workshop *AI-Native Observability: Building Self-Debugging Next.js Applications with
> OpenTelemetry* (Porto, 2026).

## Quick start

Requires Node.js 22+ and Next.js 16.

```bash
npm install next-observe
```

```ts
// next.config.ts
import { withObserve } from 'next-observe/config'
export default withObserve({ /* your config */ })
```

```ts
// instrumentation.ts
export { register } from 'next-observe/server'
```

```ts
// instrumentation-client.ts
import 'next-observe/client'
```

```bash
npx nxo dev          # collector + UI on http://127.0.0.1:4318, then `next dev`
```

Open http://127.0.0.1:4318 for traces and the chat.

## Instrument your own code

```ts
'use observe'                      // every exported function of this file gets a span

export async function chargePayment(amount: number) { … }
```

```ts
export async function loadData() {
  'use observe'                    // only this function
}
```

Spans carry `code.filepath`, so agents can point at the file where the time went. Components get a `displayName` that
survives minification.

## AI agents (optional)

```bash
npm install -D @google/adk @kitana-sdk/adk @google/genai
```

| `OBSERVE_AI` | Model |
|---|---|
| `mock` (default) | deterministic stand-in — the whole pipeline runs without tokens |
| `real` | Gemini when `GEMINI_API_KEY` + `GEMINI_MODEL` are set, otherwise [Kitana](https://www.npmjs.com/package/@kitana-sdk/adk) (Claude / Codex CLI, Ollama, API keys) |

Without `@google/adk` the collector still runs; chat is disabled and anomalies are still shown.

## CLI

```bash
nxo dev [--root <dir>] [--port <n>] [-- <next dev args>]   # collector + next dev
nxo collector [--host <h>] [--port <n>] [--api-key <k>] [--demo]
```

`--demo` preloads a sample "shop" scenario (a regression between versions, a failing endpoint, an N+1).

## Configuration

| Variable | Default | |
|---|---|---|
| `OBSERVE_ENDPOINT` | `http://127.0.0.1:4318` | collector URL (set at `next build` time for production: the browser proxy is a rewrite) |
| `OBSERVE_SERVICE_NAME` | `name` from package.json | OTel `service.name` |
| `OBSERVE_SERVICE_VERSION` | `VERCEL_GIT_COMMIT_SHA` | OTel `service.version` — lets agents compare deployments |
| `OBSERVE_API_KEY` | — | sent as `x-api-key`; the collector requires it when started with one |
| `OBSERVE_AI` | `mock` | `mock` \| `real` |
| `OBSERVE_DETECTOR` | on | `off` disables the anomaly detector |

Production React profiling: build with `next build --profile` to get component render timings.

## Entry points

| Import | For |
|---|---|
| `next-observe/config` | `withObserve()` for `next.config.ts` |
| `next-observe/server` | `register()` for `instrumentation.ts` |
| `next-observe/client` | browser telemetry for `instrumentation-client.ts` |
| `next-observe/collector` | `startCollector()`, storage, OTLP/JSON decoding |
| `next-observe/debug` | agent tools as plain functions, `AnomalyDetector`, demo data |
| `next-observe/agents` | ADK agents, chat handler (needs `@google/adk`) |

The collector accepts OTLP/HTTP **JSON** (`next-observe/server` configures it); protobuf is planned.

## License

MIT
