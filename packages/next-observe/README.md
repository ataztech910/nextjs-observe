# next-observe

OpenTelemetry for Next.js 16: server, browser and your own code. Pair it with the **[next-observer](https://www.npmjs.com/package/next-observer)**
observer for a trace UI and AI agents that investigate problems on their own.

- **Server** traces via `@vercel/otel`, **browser** traces (document load, fetch, React renders), and **your own code**
  with a `'use observe'` directive
- Only OpenTelemetry in your app: the collector, UI and AI agents live in `next-observer`, which you run with `npx` and never
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
npx next-observer dev          # observer + UI on http://127.0.0.1:4318, then `next dev`
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

`next-observer` runs three built-in specialists (latency, errors, traffic). Add or replace them in `observe.agents.ts` in the app
root — `next-observe/agents` only gives the types, `next-observer` loads and runs the file:

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

See the [next-observer README](https://www.npmjs.com/package/next-observer) for the tools and models.

## Configuration

| Variable | Default | |
|---|---|---|
| `OBSERVE_ENDPOINT` | `http://127.0.0.1:4318` | observer URL (set at `next build` time for production: the browser proxy is a rewrite) |
| `OBSERVE_SERVICE_NAME` | `name` from package.json | OTel `service.name` |
| `OBSERVE_SERVICE_VERSION` | `VERCEL_GIT_COMMIT_SHA` | OTel `service.version` — lets agents compare deployments |
| `OBSERVE_API_KEY` | — | sent as `x-api-key`; the observer requires it when started with one |

### Sending to another OpenTelemetry backend

The server exporter also reads the standard OTel variables, so traces can go to any OTLP/HTTP backend:

| Variable | |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | base URL, `/v1/traces` is appended |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | full traces URL, used as is |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | `key=value,key2=value2` (percent-encoded), e.g. `Authorization=Bearer%20…` |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | `http/json` (default) or `http/protobuf` |

Browser spans go to the app's own origin (`/__observe`) and are forwarded by the server. By default that is a rewrite whose
destination is fixed at `next build`. To read the destination and headers at **runtime** (and keep keys such as
`Authorization` on the server), add one file:

```ts
// app/api/next-observe/[...path]/route.ts   (or src/app/…)
export { POST } from 'next-observe/proxy'
```

`withObserve()` finds it and routes `/__observe/*` there; the route uses the same settings as `register()`.

**Several destinations.** `OBSERVE_*` describes the next-observer observer, `OTEL_EXPORTER_OTLP_*` your OTel backend. With
both set, every span goes to both, each with its own headers and protocol — the backend's `Authorization` never reaches
the observer and `x-api-key` never reaches the backend. Browser spans fan out the same way through the proxy route
(without it, the build-time rewrite reaches the observer only). Full control from code:

```ts
register({ destinations: [{ url: 'https://observer.example.com/v1/traces' }, { url: 'https://otlp.vendor.io/v1/traces', headers: { Authorization: 'Bearer …' }, protocol: 'http/protobuf' }] })
```

`register({ endpoint, tracesUrl, headers, apiKey, protocol })` configures the observer destination. The next-observer
observer accepts `http/json`.

Production React profiling: build with `next build --profile` to get component render timings.

## Entry points

| Import | For |
|---|---|
| `next-observe/config` | `withObserve()` for `next.config.ts` |
| `next-observe/server` | `register()` for `instrumentation.ts` |
| `next-observe/client` | browser telemetry for `instrumentation-client.ts` |
| `next-observe/agents` | `defineSpecialist()` and types for `observe.agents.ts` |
| `next-observe/proxy` | runtime proxy route for browser spans (optional) |

Traces are sent as OTLP/HTTP **JSON**.

## License

MIT
