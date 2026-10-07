# next-observer

The **observer** for Next.js: one process that receives your app's telemetry, shows it, and has **AI agents** investigate
it. A server, a UI, an anomaly detector and the agents — started with `npx`, never installed into your app.

```bash
npx next-observer init     # once: connects the app (installs the APM agent, next-observe, into it)
npm run observe            # the observer + `next dev`; open http://127.0.0.1:4318
```

No app at hand? `npx next-observer collector --demo` starts the observer with a sample shop that has four things to
find: a deployment that made checkout slower, a failing endpoint, an N+1 query, and an error the last deployment brought.

![Overview: requests, latency, errors, and a banner saying the last deployment looks like a regression](https://raw.githubusercontent.com/ataztech910/nextjs-observe/master/docs/screenshots/overview.png)

## Two packages, one letter apart

| | [`next-observe`](https://www.npmjs.com/package/next-observe) | [`next-observer`](https://www.npmjs.com/package/next-observer) |
|---|---|---|
| **What it is** | the **APM agent** | the **observer** — a server with a UI and **AI agents** |
| **Where it runs** | inside your Next.js app (a dependency) | next to the app, started with `npx` (never a dependency) |
| **What it does** | collects telemetry and sends it | receives telemetry, shows it, investigates it |
| **Contains AI?** | no — OpenTelemetry only | yes — the AI agents live here |

```
 your Next.js app                          the observer
┌──────────────────────────┐              ┌──────────────────────────────────┐
│ next-observe             │    traces    │ next-observer        (port 4318) │
│ the APM agent            │ ───────────▶ │ server · UI · anomaly detector   │
│ collects and sends       │  OTLP/HTTP   │ AI agents that investigate       │
└──────────────────────────┘              └──────────────────────────────────┘
```

**Two kinds of "agent" — they are not the same thing:**

- **APM agent** = `next-observe`. The classic meaning from application performance monitoring: a library inside the app
  that records what happens (requests, timings, errors) and ships it out. It decides nothing.
- **AI agents** = inside `next-observer`. Language models with tools that query the recorded telemetry and answer
  "what is slow, since which deployment, and where in the code". They never run inside your app.

## What you get

**Overview** — requests by status class, latency and 5xx rate, each compared with the period before; the slowest and
the busiest routes. When the latest deployment made a route slower or more error-prone, a banner says so with the
measured numbers, and **Investigate** hands the question to the AI agents.

**AI agents that investigate — asked or on their own.** The anomaly detector watches incoming traces; when errors or
latency jump it starts an investigation by itself. The agents get facts only from tools over your telemetry, and the
evidence cards under a report are built by code from those tool results, not written by the model.

![Chat: the detector noticed slow requests and the AI agents traced them to a function and a deployment](https://raw.githubusercontent.com/ataztech910/nextjs-observe/master/docs/screenshots/chat.png)

**Errors as defects** — one entry per "this operation fails with this message", not per failed request: where the
error originated, which requests fail because of it, when it was first seen, and whether the last deployment brought it.

![Errors: two defects, the first marked NEW IN V2](https://raw.githubusercontent.com/ataztech910/nextjs-observe/master/docs/screenshots/errors.png)

**Traces** — a waterfall, the critical path (the spans that decided the duration), each operation's own time, and how
this call compares with the others of its kind.

![A trace with the critical path highlighted and a table of where the time went](https://raw.githubusercontent.com/ataztech910/nextjs-observe/master/docs/screenshots/trace.png)

**One operation up close** — its latency distribution, and a note when the calls fall into two clearly separate speeds
(a fast and a slow path, or the version before and after a deployment).

![An operation page: details per version and a latency histogram with two speeds](https://raw.githubusercontent.com/ataztech910/nextjs-observe/master/docs/screenshots/operation.png)

**Copy prompt** — on a trace, a defect or a finished investigation: a ready prompt for a coding agent (Claude Code,
Cursor, …) with the measured facts and the task, so the fix starts from data instead of a retelling.

Also: cold starts are not regressions (the first request of a route after a server start is left out of latency and
marked), no Docker and no external backend, and it accepts OTLP/HTTP from any OpenTelemetry SDK — not only `next-observe`.

Requires Node.js 22.18+.

## Commands

```bash
next-observer init [--root <dir>] [--proxy]                          # connect a Next.js app (see below)
next-observer dev [--root <dir>] [--port <n>] [-- <next dev args>]   # the observer + your app's `next dev`
next-observer collector [--host <h>] [--port <n>] [--api-key <k>] [--ui-password <p>] [--demo]   # the observer alone
```

Run them with `npx next-observer <command>`; installed globally (`npm i -g next-observer`) the command is also
available as `nxo`.

`next-observer init` installs the APM agent, `next-observe`, with the project's package manager, wraps the exported `next.config` in
`withObserve()`, creates `instrumentation.ts` and `instrumentation-client.ts` (in `src/` when the app lives there; `.js`
without TypeScript) and adds an `observe` script. Already connected files stay untouched; an existing `register()` is
never rewritten — init says what to add. `--proxy` also creates the runtime proxy route for browser spans.

`next-observer dev` is a convenience for local work: it starts the observer and then your app's own `next dev` in the
same terminal. The app stays yours — the observer only launches it.

`next-observer collector` runs the observer alone — next to `next dev` in another terminal, or on a server for
production. ("Collector" is the OpenTelemetry word for the server that receives telemetry; here it comes with the UI,
the detector and the AI agents.) `--demo` preloads the sample shop and keeps sending live traffic, so the detector and
the AI agents have something to find without an app.

## On a server

The observer started with `--host 0.0.0.0` is reachable from outside — protect both doors:

```bash
next-observer collector --host 0.0.0.0 --api-key <ingest key> --ui-password <password>
```

`--api-key` is for the apps sending traces (`OBSERVE_API_KEY` in the app), `--ui-password` for the people opening the
UI and the chat (the browser asks for it). `/health` stays open for uptime checks. Without them the banner warns.

## Models for the AI agents

| `OBSERVE_AI` | Model |
|---|---|
| `mock` (default) | deterministic stand-in — the whole pipeline runs without a model, tokens or a network |
| `real` | Gemini when `GEMINI_API_KEY` + `GEMINI_MODEL` are set, otherwise [Kitana](https://www.npmjs.com/package/@kitana-sdk/adk) (Claude / Codex CLI, Ollama, API keys) |

One investigation makes 7–12 model calls. A call that hangs is started again once; "too many requests" (429) and
"overloaded" (5xx) are waited for and retried — up to a minute, as the provider asks. A free Gemini tier allows only a
few requests per minute, so an investigation may pause for that minute; a key without credits, a wrong key or a wrong
model name is explained in the chat in plain words.

## Your own AI agents

The built-in AI agents are an orchestrator and three specialists (latency, errors, traffic). To change them, put `observe.agents.ts` (or `.mts`, `.js`, `.mjs`) in the app root. A specialist with a built-in name
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
| `OBSERVE_MODEL_TIMEOUT_MS` | `90000` | how long one model call may take before it is started again |
| `OBSERVE_API_KEY` | — | require `x-api-key` on ingest (`/v1/traces`) |
| `OBSERVE_UI_PASSWORD` | — | require a password for the UI, the query API and the chat (browser login, any user name) |
| `OBSERVE_PORT`, `OBSERVE_HOST`, `OBSERVE_ROOT` | `4318`, `127.0.0.1`, `.` | same as `--port`, `--host`, `--root` |

Accepts OTLP/HTTP traces from any OpenTelemetry SDK or Collector: `application/json` and `application/x-protobuf`,
optionally `Content-Encoding: gzip`, on `/v1/traces`.

## Entry points

| Import | For |
|---|---|
| `next-observer/collector` | `startCollector()`, storage, OTLP/JSON decoding |
| `next-observer/debug` | agent tools as plain functions, `AnomalyDetector`, demo data |
| `next-observer/agents` | ADK agents, chat handler, built-in specialists |

## License

MIT
