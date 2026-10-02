# next-observe

OpenTelemetry for Next.js 16: server, browser and your own code. Pair it with the **[nxo](https://www.npmjs.com/package/nxo)**
observer for a trace UI and AI agents that investigate problems on their own.

- **Server** traces via `@vercel/otel`, **browser** traces (document load, fetch, React renders), and **your own code**
  with a `'use observe'` directive
- Only OpenTelemetry in your app: the collector, UI and AI agents live in `nxo`, which you run with `npx` and never
  install into the app

> Reference implementation for the workshop *AI-Native Observability: Building Self-Debugging Next.js Applications with
> OpenTelemetry* (Porto, 2026).

## Quick start

Requires Node.js 22.18+ and Next.js 16.

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
npx nxo dev          # observer + UI on http://127.0.0.1:4318, then `next dev`
```

Open http://127.0.0.1:4318 for traces and the chat with the agents.

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

## Your own agents

`nxo` runs three built-in specialists (latency, errors, traffic). Add or replace them in `observe.agents.ts` in the app
root — `next-observe/agents` only gives the types, `nxo` loads and runs the file:

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

See the [nxo README](https://www.npmjs.com/package/nxo) for the tools and models.

## Configuration

| Variable | Default | |
|---|---|---|
| `OBSERVE_ENDPOINT` | `http://127.0.0.1:4318` | observer URL (set at `next build` time for production: the browser proxy is a rewrite) |
| `OBSERVE_SERVICE_NAME` | `name` from package.json | OTel `service.name` |
| `OBSERVE_SERVICE_VERSION` | `VERCEL_GIT_COMMIT_SHA` | OTel `service.version` — lets agents compare deployments |
| `OBSERVE_API_KEY` | — | sent as `x-api-key`; the observer requires it when started with one |

Production React profiling: build with `next build --profile` to get component render timings.

## Entry points

| Import | For |
|---|---|
| `next-observe/config` | `withObserve()` for `next.config.ts` |
| `next-observe/server` | `register()` for `instrumentation.ts` |
| `next-observe/client` | browser telemetry for `instrumentation-client.ts` |
| `next-observe/agents` | `defineSpecialist()` and types for `observe.agents.ts` |

Traces are sent as OTLP/HTTP **JSON**.

## License

MIT
