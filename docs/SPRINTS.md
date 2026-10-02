# Sprint Plan

Workshop reference implementation — Porto 2026.  
9 sprints × ~1 week. Each sprint is a shippable increment.

---

## Sprint 0 — Monorepo foundation

**Goal**: Turborepo monorepo running, CI green, shared tooling in place.

### Tasks

- [ ] Init Turborepo with pnpm workspaces
- [ ] Create 5 package skeletons: `sdk`, `server`, `ui`, `debug`, `cli`
- [ ] Shared `tsconfig.base.json` (strict, ESM, decoratorMetadata)
- [ ] Shared `vitest.config.ts` with SWC transformer
- [ ] oxlint config
- [ ] GitHub Actions: typecheck + lint + test on PR
- [ ] `turbo.json`: build → test dependency graph

### Output
```
nextjs-observe/
  packages/
    sdk/       package.json, tsconfig.json, src/index.ts
    server/    package.json, tsconfig.json, src/index.ts
    ui/        package.json (Next.js 15)
    debug/     package.json, tsconfig.json, src/index.ts
    cli/       package.json, src/index.ts
  turbo.json
  pnpm-workspace.yaml
```

### Key decisions
- ESM only (`"type": "module"`) — matches Next.js 15 expectations
- `exports` field in every package.json — no deep imports
- `vitest` + `unplugin-swc` for decorator metadata support

---

## Sprint 1 — StorageAdapter + BrokerAdapter interfaces + SQLite

**Goal**: Core interfaces defined, SQLite adapter working, in-memory broker working.  
This is the foundation — everything else implements these interfaces.

### Tasks

- [ ] Define `StorageAdapter` interface with full TypeScript types
- [ ] Define `BrokerAdapter` interface
- [ ] Define shared types: `NormalizedSpan`, `Trace`, `NormalizedMetric`, `NormalizedLogEntry`, `TraceFilter`
- [ ] `SqliteAdapter` — uses `better-sqlite3`, sync writes, TTL via periodic DELETE
- [ ] `InMemoryAdapter` — for tests and Tier 0
- [ ] `InMemoryBroker` — synchronous, direct dispatch
- [ ] Unit tests for both adapters
- [ ] `StorageAdapterFactory.create(config)` — factory from env vars

### Key design
```ts
// No framework dependencies — pure TypeScript interfaces
interface StorageAdapter {
  insertSpans(spans: NormalizedSpan[]): Promise<void>
  queryTraces(filter: TraceFilter): Promise<Trace[]>
  queryMetrics(filter: MetricFilter): Promise<NormalizedMetric[]>
  queryLogs(filter: LogFilter): Promise<NormalizedLogEntry[]>
  purgeOlderThan(days: number): Promise<void>
}

interface BrokerAdapter {
  publish(topic: TelemetryTopic, payload: Buffer, opts?: PublishOptions): Promise<void>
  subscribe(topic: TelemetryTopic, handler: JobHandler): void
}
```

---

## Sprint 2 — Server: OTLP ingest + auth

**Goal**: Fastify server accepts OTLP/HTTP payloads, validates API key, routes to broker.

### Tasks

- [ ] Fastify server setup with TypeBox schema validation

**Phase A — OTLP/JSON (MVP, needed for the workshop)**:
- [ ] `POST /v1/traces`, `/v1/metrics`, `/v1/logs` — accept `application/json`; reply `415` to other content types
- [ ] `next-observe/server` configures `OTLPHttpJsonTraceExporter` (from `@vercel/otel`) by default; browser exporter is JSON already — our own SDK never sends protobuf (verified in POC)
- [ ] OTLP JSON → `NormalizedSpan[]` decoder (ids hex, `startTimeUnixNano` as string → bigint)
- [ ] Auth middleware: validate `x-api-key` header
- [ ] Route decoded payload to `BrokerAdapter.publish()`
- [ ] Health check: `GET /health`
- [ ] Integration test: send real OTLP JSON, assert stored correctly

**Phase B — OTLP/protobuf (required before production)**:
- [x] Accept `application/x-protobuf` on `/v1/traces` (step 29; metrics/logs endpoints don't exist yet) — the OTLP default for most SDKs and for `@vercel/otel` without an explicit exporter, and what the OTel Collector sends
- [x] ~~Decoder via `protobufjs` + `.proto` files~~ → own ~200-line wire-format reader for the trace messages only, no dependency (step 29); verified byte-for-byte against the official serializers
- [x] Protobuf and JSON produce identical `NormalizedSpan[]` — one shared normalizer after decoding
- [x] `Content-Encoding: gzip` support (the OTel Collector's `otlphttp` exporter sends gzip by default; SDKs enable it via `OTEL_EXPORTER_OTLP_COMPRESSION`)
- [x] Contract tests: the same spans serialized by the real OTel protobuf and JSON serializers → identical rows (unit), plus e2e with `@opentelemetry/exporter-trace-otlp-proto` + gzip
- [ ] Then switch `next-observe/server` default to protobuf (smaller payloads), keep JSON as an option

### Key decisions
- Server speaks standard OTLP — any OTel SDK works against it
- `@opentelemetry/otlp-transformer` **cannot** decode incoming requests — it only has `serializeRequest` / `deserializeResponse` (checked in 0.222). Protobuf decode is our own: `protobufjs` + OTLP `.proto`
- JSON first because we control both ends (our SDK sets the exporter); protobuf is mandatory for production, where arbitrary OTel SDKs and Collectors send to us
- Auth is stateless API key — no session, no JWT for now

---

## Sprint 3 — Supabase + MongoDB adapters + BullMQ broker

**Goal**: Production-viable storage and broker options. Free tier usable.

### Tasks

**Supabase adapter**:
- [ ] `SupabaseAdapter` using `@supabase/supabase-js`
- [ ] SQL schema (spans, metrics, logs tables)
- [ ] `pg_cron` job for TTL cleanup
- [ ] Realtime channel setup for live dashboard feed + chat zone push
- [ ] Migration runner (SQL files in `migrations/`)

**MongoDB adapter**:
- [ ] `MongoAdapter` using `mongodb` driver
- [ ] Document schema for traces (spans as nested array)
- [ ] TTL index on `startedAt`
- [ ] Aggregation pipeline for analytics queries

**BullMQ broker**:
- [ ] `BullMQBroker` — Queue per topic, Worker per topic
- [ ] Priority config: errors=1, spans=3, metrics=4, logs=5
- [ ] Retry with exponential backoff (attempts=5)
- [ ] Dead letter queue for failed jobs
- [ ] Bull Board setup at `/admin/queues`
- [ ] `BullMQBroker.subscribe()` — used by observe-debug in Sprint 9

### Integration test
- [ ] Send 1000 spans via OTLP → assert all in Supabase
- [ ] Kill server mid-write → assert retry delivers all spans

---

## Sprint 4 — SDK: Node.js instrumentation

**Goal**: `instrumentation.ts` + `withObserve()` working end-to-end in a real Next.js app.

### Tasks

- [ ] `defineConfig()` — config builder with validation
- [ ] `register()` for `instrumentation.ts`:
  - `NodeTracerProvider` setup
  - `BatchSpanProcessor` + `OTLPTraceExporter` with `x-api-key`
  - W3C TraceContext propagator
  - `HttpInstrumentation`, `FetchInstrumentation`, `UndiciInstrumentation`
- [ ] Monkey-patch `globalThis.fetch` for outgoing span + header injection
- [ ] Monkey-patch `node:http` / `node:https`
- [ ] Monkey-patch `React.cache` — preserve ALS context
- [ ] `withObserve(handler)` — route handler wrapper
  - Opens ALS context with `traceId`, `spanId`
  - Creates root span
  - Closes span on response/error
- [ ] `withObserveAction(fn)` — Server Action wrapper

### Integration test
- [ ] Boot Next.js app, make 10 requests, assert 10 traces in server
- [ ] Nested `fetch()` inside handler creates child span with `traceparent` header

---

## Sprint 5 — SDK: Edge Runtime + Browser

**Goal**: Spans from Edge routes and browser client components reaching the server.

### Tasks

**Edge Runtime**:
- [ ] Detect `NEXT_RUNTIME === 'edge'` in `register()`
- [ ] Use `SimpleSpanProcessor` instead of `BatchSpanProcessor`
- [ ] Flush via `after()` from `next/server`
- [ ] Test: Edge route → spans reach server

**Browser**:
- [ ] `instrumentation-client.ts`:
  - `WebTracerProvider` + `SimpleSpanProcessor` + `OTLPTraceExporter`
  - `DocumentLoadInstrumentation`
  - `FetchInstrumentation`
- [ ] Auto-inject `traceparent` into all `fetch()` calls from browser
- [ ] Test: browser page load creates `document-load` span in server

**Manual API**:
- [ ] `observe.span(name, callback)` — works in all runtimes
- [ ] `observe.currentTraceId()` — never throws, returns null if no context
- [ ] `observe.setAttribute(key, value)` — on current span

---

## Sprint 6 — BullMQ instrumentation (distributed tracing)

**Goal**: Request → BullMQ job trace linking working end-to-end.

### Tasks

- [ ] Monkey-patch `Queue.prototype.add`:
  - Read `{ traceId, spanId }` from ALS
  - Inject `{ __observe: { traceId, spanId } }` into job data
- [ ] `withObserveWorker(processor)`:
  - Extract `job.data.__observe`
  - Create new trace with OTel Link to parent `{ traceId, spanId }`
  - Run processor in `als.run(new Map([['traceId', newTraceId]]), fn)`
- [ ] Span attributes on job span:
  - `bullmq.job.id`, `bullmq.job.name`, `bullmq.queue.name`, `bullmq.attempt`
- [ ] Job retry — each attempt creates a new span linked to original

### Integration test
- [ ] `POST /api/checkout` → enqueues `send-receipt` job
- [ ] Worker processes job
- [ ] Assert: server has 2 traces, linked to each other via OTel Link
- [ ] Dashboard shows: `abc-123 → def-789` link

---

## Sprint 7 — UI: Trace Explorer + Live Feed + Chat zone

**Goal**: Full observe-ui working. Dogfoods the SDK. Chat zone ready for Sprint 9 streaming.

### Tasks

**Trace Explorer**:
- [ ] Next.js 15 app with `@nextjs/observe` SDK installed (dogfooding)
- [ ] tRPC router talking to `nextjs-observe-server` query API
- [ ] List view: service, operation, duration, status, timestamp
- [ ] Filter by: service, operation, time range, status, traceId
- [ ] Detail view: span waterfall, attributes panel
- [ ] Linked trace navigation (request → job)

**Live Feed**:
- [ ] Supabase Realtime channel subscription
- [ ] New spans appear in real-time without page refresh
- [ ] InMemory fallback: polling every 2s when Supabase not configured

**Metrics view**:
- [ ] Node.js runtime: memory, CPU, event loop latency
- [ ] Custom metrics: counter, gauge
- [ ] Bull Board embedded at `/admin/queues`

**Chat zone** (shell — filled in Sprint 9):
- [ ] `/chat` page layout
- [ ] Message list component — supports text and React component messages
- [ ] Input field + send button
- [ ] Proactive message slot — where Anomaly Detector pushes streaming UI
- [ ] Interactive message slot — where user questions get answered
- [ ] Loading state while agent streams

---

## Sprint 8 — CLI + distribution

**Goal**: `npx nextjs-observe@latest init` and `npx nextjs-observe dev` work. npm published.

### Tasks

**CLI**:
- [ ] `@clack/prompts` interactive setup wizard
- [ ] Questions: service name, storage, broker, Redis URL, LLM provider, auth
- [ ] Generators:
  - `.env.local`
  - `instrumentation.ts`
  - `nextjs-observe.config.ts`
  - SQL migration files
  - `docker-compose.yml` (optional, Tier 1 / Tier 2 — generated on request)
- [ ] `npx nextjs-observe dev` — starts server + ui concurrently, opens browser
- [ ] `npx nextjs-observe add` — add SDK to existing Next.js project
- [ ] `npx nextjs-observe deploy --target railway|fly|render`

### Key decision
- Docker is optional, not required — `npx nextjs-observe dev` runs everything via Node.js
- Docker compose generated only if user explicitly asks during `init`

**Publish**:
- [ ] `@nextjs/observe` on npm
- [ ] `@nextjs/observe-debug` on npm
- [ ] `nextjs-observe` (CLI) on npm
- [ ] Changelog + release-it config

---

## Sprint 9 — observe-debug: Anomaly Detector + ADK agents + Streaming UI

**Goal**: App detects its own anomalies, investigates via AI agents, streams UI into chat zone.  
This is the self-debugging loop — the centrepiece of the Porto workshop demo.

### Architecture

```
Next.js app generates spans
    ↓ OTLP
observe-server → BullMQ 'spans' topic
    ↓ subscriber (observe-debug)
Anomaly Detector — sliding window 10s
    ↓ if errorRate > 20% OR slowRate > 30% OR noTraffic
ADK Orchestrator
  ├── Latency Agent   (searchTraces minDuration, getOperationStats)
  ├── Error Agent     (searchTraces error=true, getTrace)
  ├── Traffic Agent   (getServices, searchTraces volume)
  └── Report Agent    (no tools — synthesizes, generates UI components)
    ↓ streamUI() via Next.js Server Action
Chat zone in observe-ui
  ├── Proactive: anomaly found → components stream automatically
  └── Interactive: user asks question → agent responds with components
```

### Tasks

**Anomaly Detector**:
- [ ] `BrokerAdapter.subscribe('spans', handler)` — event-driven, not polling
- [ ] Sliding window accumulator: collects spans over `windowMs` (default 10s)
- [ ] Three anomaly rules:
  - `errorRate > threshold` (default 0.2)
  - `slowRate > threshold` — spans with `duration > p99LatencyMs` (default 1000ms)
  - `noTraffic` — zero spans in `noTrafficWindowMs` (default 120s)
- [ ] Deduplication: same anomaly type not re-triggered within `cooldownMs` (default 5min)
- [ ] `InMemoryBroker` fallback for SQLite Tier 0 — same interface, synchronous

**ADK Orchestrator**:
- [ ] Four agents: Latency, Error, Traffic, Report
- [ ] Each agent's tools use `StorageAdapter.queryTraces()` — not Jaeger REST API
- [ ] Orchestrator routes by anomaly type:
  - `high_error_rate` → Error Agent first, then Latency
  - `high_latency` → Latency Agent first, then Traffic
  - `no_traffic` → Traffic Agent only
  - manual question → all three in parallel
- [ ] LLM config:
  - `{ provider: 'gemini', apiKey }` — direct Gemini API
  - `{ provider: 'kitana' }` — `@kitana-sdk/adk` adapter, no server needed, built-in router with Claude CLI / Gemini CLI fallback
- [ ] Report Agent system prompt: "Max 5 sentences. Write for on-call engineer at 3am. Never suggest automated fixes."

**Streaming UI components**:
- [ ] `AnomalyCard` — type, severity, summary, error rate, affected trace count
- [ ] `LatencyChart` — p50/p95/p99 bar chart, operation name, Recharts
- [ ] `TraceList` — clickable list of trace IDs, links to Trace Explorer
- [ ] `RootCauseCard` — service, operation, explanation, fix suggestion
- [ ] All components: shadcn/ui base, consistent with observe-ui design tokens

**streamUI() integration**:
- [ ] Next.js Server Action `investigateAnomaly(report)` — calls ADK, returns `streamUI()`
- [ ] Next.js Server Action `askAgent(question)` — interactive mode
- [ ] Chat zone polls for proactive messages via Supabase Realtime (when available)
- [ ] Proactive trigger: Anomaly Detector calls Server Action directly (same process)
- [ ] Message history: last 50 messages persisted in storage

**defineConfig() additions**:
```ts
debug: {
  enabled: boolean           // default false
  windowMs: number           // sliding window, default 10_000
  cooldownMs: number         // dedup cooldown, default 300_000
  thresholds: {
    errorRate: number        // default 0.2
    p99LatencyMs: number     // default 1000
    noTrafficWindowMs: number // default 120_000
  }
  llm:
    | { provider: 'gemini'; apiKey: string; model?: string }
    | { provider: 'kitana' }  // zero config if Kitana CLI running
}
// No reporter config — all output goes to chat zone in observe-ui
```

### Integration tests
- [ ] Send 50 spans with 40% errors → assert anomaly detected within 15s
- [ ] Anomaly detected → assert ADK called with correct context
- [ ] ADK response → assert `streamUI()` returns at least one component
- [ ] Same anomaly twice within cooldown → assert agent called only once
- [ ] `noTraffic` after 120s silence → assert Traffic Agent triggered

---

## Definition of Done (per sprint)

- All tasks checked
- Unit tests pass (`vitest run`)
- Integration tests pass (`vitest run --config vitest.int.config.ts`)
- TypeScript strict — zero errors
- No lint errors (oxlint)
- README updated for new public APIs

---

## Workshop structure (Porto 2026)

| Блок | Спринт | Концепция |
|---|---|---|
| 0 — Вступление | — | Архитектура продукта целиком, что строим |
| 1 — Теория | 1, 2 | Трейс, OTel стандарт, OTLP, adapter pattern |
| 2 — Старт | 8 | `npx nextjs-observe init` + `npx nextjs-observe dev` |
| 3 — Инструментация | 4, 5 | SDK, `withObserve()`, кастомные спаны, Live Feed |
| 4 — AI агенты | 9 (частично) | Four Golden Signals, ADK, Gemini vs Kitana |
| 5 — Self-debug demo | 9 | Anomaly Detector, sliding window, streamUI() |
| 6 — Итог | — | OTel как стандарт, паттерн важнее инструмента |

---

## Backlog — SWC plugin for `'use observe'`

**Status**: postponed. The transform currently runs on **Babel inside our loader** (`turbopack.rules` + `condition.content`); Next itself stays on SWC.

**Goal**: move the `'use observe'` transform into a native SWC wasm plugin loaded via `experimental.swcPlugins`, so it runs inside Next's compiler (Turbopack and webpack) without a loader.

### Verified
- Next 16.3.7 ships `swc_plugin_runner 30.0.1` and `swc_ecma_transform_plugins` inside Turbopack (`next-core`) → `swcPlugins` work with Turbopack.

### Tasks
- [ ] Port the Babel transform to Rust (`swc_core`, target `wasm32-wasip1`), same semantics: file-level and function-level directive, body wrap into `__observe.run()`, `displayName`
- [ ] Publish prebuilt `.wasm` as `next-observe/swc`
- [ ] `withObserve({ transform: 'swc' | 'babel' })` — Babel loader stays as fallback
- [ ] Same test suite as the Babel POC (`app/observe/*`)
- [ ] Check ordering vs Next's `'use server'` / `'use client'` transforms
- [ ] Benchmark `next build`: Babel loader (runs only on files with the directive) vs SWC plugin (runs on every module, AST serialized into wasm)
- [ ] CI matrix over Next versions + compatibility table "Next version → plugin version" (plugin ABI is tied to Next's `swc_core`)

### Key decisions
- Babel version remains the workshop teaching material (readable in 5 minutes); the SWC plugin is the product path
- Switch the default to SWC only if it wins the benchmark and passes the ordering check
