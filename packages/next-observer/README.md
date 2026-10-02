# next-observer

The observer for **[next-observe](https://www.npmjs.com/package/next-observe)**: an OTLP collector, a trace UI, an anomaly
detector and AI agents (Google ADK) that investigate your Next.js app on their own. Run it with `npx` — it never goes
into your app's dependencies.

```bash
npx next-observer dev          # observer + UI on http://127.0.0.1:4318, then `next dev` in the current directory
```

- **Trace UI** — list + waterfall, no Docker, no external backend
- **Chat with agents** that query your telemetry: slow operations, regressions between deployments, failing operations
  with exact errors, N+1 patterns — with evidence cards built from the data, not by the model
- **Anomaly detector** that starts an investigation by itself when error rates or latency jump

Requires Node.js 22.18+. The app is instrumented with `next-observe` (see its README).

## Commands

```bash
next-observer dev [--root <dir>] [--port <n>] [-- <next dev args>]   # observer + next dev
next-observer collector [--host <h>] [--port <n>] [--api-key <k>] [--demo]
```

Run them with `npx next-observer <command>`; installed globally (`npm i -g next-observer`) the command is also
available as `nxo`.

`next-observer collector` runs the observer alone — next to `next dev` in another terminal, or on a server for production.
`--demo` preloads a sample "shop" scenario (a regression between versions, a failing endpoint, an N+1).

## Models

| `OBSERVE_AI` | Model |
|---|---|
| `mock` (default) | deterministic stand-in — the whole pipeline runs without tokens |
| `real` | Gemini when `GEMINI_API_KEY` + `GEMINI_MODEL` are set, otherwise [Kitana](https://www.npmjs.com/package/@kitana-sdk/adk) (Claude / Codex CLI, Ollama, API keys) |

## Your own specialists

Put `observe.agents.ts` (or `.mts`, `.js`, `.mjs`) in the app root. A specialist with a built-in name
(`latency_agent`, `error_agent`, `traffic_agent`) replaces it; a new name adds one. The orchestrator picks specialists by
their `description`; the rules "facts from tools only" and "own tools only" are added to every instruction.

```ts
import { defineSpecialist } from 'next-observe/agents'

export default [
  defineSpecialist({
    name: 'latency_agent',
    description: 'Finds slow operations and the deployment that made them slow',
    instruction: 'First call compare_versions; then open one slow trace and name the span with the highest selfMs.',
    tools: ['compare_versions', 'search_traces', 'get_trace'],
  }),
]
```

Tools: `get_services`, `get_operation_stats`, `compare_versions`, `get_errors`, `search_traces`, `get_trace`.
`next-observer` validates the file and lists the loaded specialists on start.

## Configuration

| Variable | Default | |
|---|---|---|
| `OBSERVE_AI` | `mock` | `mock` \| `real` |
| `OBSERVE_DETECTOR` | on | `off` disables the anomaly detector |
| `OBSERVE_API_KEY` | — | require `x-api-key` on ingest and API |
| `OBSERVE_PORT`, `OBSERVE_HOST`, `OBSERVE_ROOT` | `4318`, `127.0.0.1`, `.` | same as `--port`, `--host`, `--root` |

Accepts OTLP/HTTP **JSON** (what `next-observe` sends); protobuf is planned.

## Entry points

| Import | For |
|---|---|
| `next-observer/collector` | `startCollector()`, storage, OTLP/JSON decoding |
| `next-observer/debug` | agent tools as plain functions, `AnomalyDetector`, demo data |
| `next-observer/agents` | ADK agents, chat handler, built-in specialists |

## License

MIT
