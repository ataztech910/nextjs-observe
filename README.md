# nextjs-observe

> OpenTelemetry-based observability platform for Next.js applications.  
> Workshop reference implementation — Porto 2026.

## What is this?

`nextjs-observe` is a complete observability solution for Next.js, inspired by `@nestjs/observe`.  
It collects traces, metrics and logs from your Next.js app and ships them to a self-hosted (or managed) collector with a built-in dashboard.

Unlike `@vercel/otel` (which requires Vercel infrastructure), this works anywhere — VPS, Railway, Fly.io, Kubernetes, or your laptop.

## How it works

```
Next.js App
  instrumentation.ts  ←  auto monkey-patches fetch, http, React.cache
  instrumentation-client.ts  ←  browser SDK
  withObserve(handler)  ←  route handler wrapper
  withObserveWorker(processor)  ←  BullMQ job wrapper

        ↓  OTLP/HTTP  +  x-api-key

nextjs-observe-server
  Fastify  →  Auth  →  BullMQ queue  →  Storage (Supabase / ClickHouse)

        ↓

nextjs-observe-ui  (Next.js dashboard, dogfoods the SDK)
```

## Packages

| Package | Description |
|---|---|
| `@nextjs/observe` | Next.js SDK — instrumentation, wrappers, OTel config |
| `nextjs-observe-server` | OTLP collector + auth + queue + storage |
| `nextjs-observe-ui` | Dashboard — trace explorer, metrics, logs |
| `nextjs-observe` | CLI — setup wizard, deploy, project management |

## Quick start

```bash
# Setup wizard — generates docker-compose, .env, instrumentation.ts
npx nextjs-observe@latest init

# Add SDK to your Next.js app
npm install @nextjs/observe

# Start the server locally
docker compose up
```

## Reference projects

| Project | What we learned |
|---|---|
| `vercel-otel-test` | OTel SDK setup for Next.js (Node.js + Edge + Browser) |
| `@nestjs/observe` | Architecture: Proxy instrumentation, SharedArrayBuffer, worker thread, wire protocol |
