# Architecture

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js Application                                            │
│                                                                 │
│  instrumentation.ts ──────── register()                        │
│    monkey-patches:                                              │
│      globalThis.fetch       → outgoing span + traceparent      │
│      node:http / node:https → outgoing span + traceparent      │
│      React.cache            → preserve ALS context             │
│      Queue.prototype.add    → inject trace context into job    │
│                                                                 │
│  instrumentation-client.ts  → WebTracerProvider (browser)      │
│                                                                 │
│  Route Handlers  ── withObserve(handler)                       │
│    ALS context opened per request                              │
│    spans created/closed automatically                          │
│                                                                 │
│  BullMQ Workers  ── withObserveWorker(processor)               │
│    trace context restored from job.data.__observe              │
│    linked trace created (request → job)                        │
│                                                                 │
│  Manual API (optional):                                         │
│    observe.span('name', async (span) => { ... })               │
│    span.setAttribute('key', value)                             │
│    observe.currentTraceId()                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OTLP/HTTP
                           │ x-api-key: obs_live_xxxx
                           │ POST /v1/traces
                           │ POST /v1/metrics
                           │ POST /v1/logs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  nextjs-observe-server  (Fastify)                               │
│                                                                 │
│  Auth middleware  → validate x-api-key                         │
│  OTLP decode     → protobuf or JSON                            │
│  Normalize       → internal Span/Metric/LogEntry format        │
│                                                                 │
│  BrokerAdapter.publish('spans', payload, { priority: 3 })      │
│    → BullMQ queue  (or Kafka / Redis Streams / InMemory)       │
│                                                                 │
│  BullMQ Worker (priority: errors first)                        │
│    → StorageAdapter.insertSpans(spans)                         │
│    → retry on storage failure (exponential backoff)            │
│    → purge TTL (pg_cron / ClickHouse TTL / MongoDB TTL index)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Storage  (pluggable adapter)                                   │
│                                                                 │
│  Supabase (PostgreSQL)  ← default, free tier available         │
│  MongoDB Atlas          ← traces as documents, TTL indexes      │
│  ClickHouse             ← analytics, high volume, best perf    │
│  SQLite / Turso         ← dev / Tier 0                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ query API (tRPC)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  nextjs-observe-ui  (Next.js — dogfoods the SDK)               │
│                                                                 │
│  Trace Explorer  — waterfall, linked traces (request → job)    │
│  Service Map     — dependency graph                            │
│  Metrics         — runtime (memory, CPU, event loop)           │
│  Log Viewer      — correlated to trace                         │
│  Live Feed       — Supabase Realtime websocket                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Instrumentation strategy

### Node.js runtime

**Entry point**: `instrumentation.ts` → `register()` called once per cold start by Next.js 15+.

**OTel SDK setup**:
```
NodeTracerProvider
  + BatchSpanProcessor         → buffers spans, flushes every 5s or at 512 span batch
  + OTLPTraceExporter          → POST /v1/traces with x-api-key header
  + W3C TraceContext propagator → traceparent / tracestate headers
  + Baggage propagator
```

**Auto-instrumentations registered**:
- `HttpInstrumentation` — all inbound and outbound Node.js HTTP
- `FetchInstrumentation` — globalThis.fetch
- `UndiciInstrumentation` — Next.js internal fetch (undici)

**Monkey-patches**:
- `React.cache` — wraps cached functions in `als.run(store, fn)` to preserve ALS context across cache hits
- `Queue.prototype.add` — injects `{ __observe: { traceId, spanId } }` into job data

### Edge Runtime

Same OTel SDK but:
- No `worker_threads`, no `SharedArrayBuffer`
- `BatchSpanProcessor` replaced with `SimpleSpanProcessor` (synchronous)
- Spans flushed via `after()` from `next/server` — runs after response is sent, no latency added

### Browser

**Entry point**: `instrumentation-client.ts` — Next.js 15+ bundles and executes this before React hydration.

```
WebTracerProvider
  + SimpleSpanProcessor        → immediate flush (acceptable in browser)
  + OTLPTraceExporter          → fetch-based, points at nextjs-observe-server
  + DocumentLoadInstrumentation → page navigation timing
  + FetchInstrumentation        → all window.fetch calls
```

---

## AsyncLocalStorage — request context

Every request gets its own ALS store:

```
als.run(new Map([
  ['traceId',  'trace_01J...'],
  ['spanId',   'sp_01J...'],
  ['service',  'my-app'],
]), async () => {
  // All code in this async subtree sees this store
  // Nested withObserve / withObserveAction calls read + extend it
})
```

Problem: `React.cache()` can break ALS propagation on cache hits.  
Solution: Patch `React.cache` to wrap functions in `als.run(currentStore, fn)`.

---

## BullMQ — distributed trace linking

The key pattern for linking HTTP request traces to async job traces:

```
Step 1 — Enqueue (in route handler, ALS context active):
  Queue.prototype.add (patched)
    → reads { traceId, spanId } from als.getStore()
    → data = { ...userdata, __observe: { traceId, spanId } }

Step 2 — Process (in Worker, different process, ALS empty):
  withObserveWorker(processor)
    → reads job.data.__observe
    → creates new traceId for this job execution
    → links to parent via OTel Link: { traceId, spanId }
    → runs processor inside als.run(new Map([['traceId', newTraceId], ...]))
```

Result in dashboard:
```
Trace abc-123  GET /api/checkout  45ms
  └──► [linked] Trace def-789  Worker: send-receipt  154ms
```

---

## Wire protocol

### SDK → Server

```
POST /v1/traces
Content-Type: application/json  (or application/x-protobuf)
x-api-key: obs_live_xxxx

Body: OTLP ExportTraceServiceRequest
```

Standard OTLP — any OTel-compatible backend also works as a drop-in replacement.

### Server → Storage (internal)

```ts
interface StorageAdapter {
  insertSpans(spans: NormalizedSpan[]): Promise<void>
  queryTraces(filter: TraceFilter): Promise<Trace[]>
  queryMetrics(filter: MetricFilter): Promise<NormalizedMetric[]>
  queryLogs(filter: LogFilter): Promise<NormalizedLogEntry[]>
  purgeOlderThan(days: number): Promise<void>
}
```

### Server → Broker (internal)

```ts
interface BrokerAdapter {
  publish(topic: TelemetryTopic, payload: Buffer, opts?: PublishOptions): Promise<void>
  subscribe(topic: TelemetryTopic, handler: JobHandler): void
}
```

---

## Declarative dashboard system

The dashboard UI is driven by two layers of YAML schemas — no repetitive React per screen.

### Two schema types — different processing strategies

```
Panel schema YAML                    Dashboard config YAML
(panel authors / plugins)            (users / AI / GitOps)
        │                                     │
        ▼  BUILD TIME                         ▼  RUNTIME
  yaml-to-zod                        yaml.parse()
  tsc compilation                    validate against already-compiled Zod
  full TypeScript types generated    no rebuild needed — edit YAML → reload
        │                                     │
        ▼                                     ▼
  Zod validators in memory           DashboardConfig (typed TS object)
  PanelDefinition<TConfig, TData>           │
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
                 PanelRegistry
                       │
                       ▼
               PanelGrid → PanelRenderer → RSC
```

**Why build time for panel schemas**: panel types change only when a package version changes. Compiling them gives full TypeScript types (`PanelConfig<TraceList>`), IDE autocomplete inside `.tsx` files, and compile-time errors if a panel implementation doesn't match its schema. Runtime parse would lose all of that.

**Why runtime for dashboard configs**: users and AI generate dashboards without rebuilding. GitOps sync (`dashboard push`) drops new YAML files → server reads them on next request. Ephemeral AI dashboards are saved to storage and read back — no build step involved. The Zod validators (built from panel schemas at build time) are already in memory to validate them.

### Panel schema YAML

Written once per panel type. Ships inside npm packages (`@nextjs/observe-ui`, plugins).

```yaml
# packages/ui/src/panels/trace-list.schema.yaml
type: trace-list
label: Trace List
config:
  service:
    type: string
    optional: true
  hasError:
    type: boolean
    optional: true
    default: false
  limit:
    type: number
    default: 50
    min: 1
    max: 500
emits:
  selected:
    traceId: string
    service: string
    duration: number
    status: number
defaultSize:
  w: 12
  h: 6
```

### Dashboard config YAML

Written by users or generated by AI. Stored in `dashboards/` folder (GitOps) or in DB (ephemeral AI dashboards).

```yaml
# dashboards/traces.yaml
title: Traces
version: 1

panels:
  - id: filter
    type: filter-bar
    position: { x: 0, y: 0, w: 12, h: 1 }
    config:
      fields: [service, operation, status, timeRange]

  - id: list
    type: trace-list
    position: { x: 0, y: 1, w: 8, h: 6 }
    config:
      limit: 50
      service: "{{ filter.service }}"
      hasError: "{{ filter.status == 'error' }}"

  - id: waterfall
    type: span-waterfall
    position: { x: 0, y: 7, w: 12, h: 8 }
    config:
      traceId: "{{ list.selected.traceId }}"
```

### Binding engine — `{{ expr }}`

Panels communicate through reactive bindings, not prop drilling:

```
filter.service      →  list.config.service   (filter controls list query)
list.selected       →  waterfall.config       (row click opens waterfall)
incidents.selected  →  report.config          (incident click opens report)
```

Bindings are resolved at render time. No React state, no useEffect, no prop chains.

### PanelRegistry

```ts
interface PanelDefinition<TConfig, TData> {
  type: string
  configSchema: ZodSchema<TConfig>       // generated from YAML at build time
  query: (config: TConfig, storage: StorageAdapter) => Promise<TData>
  render: (data: TData, config: TConfig) => ReactElement
  defaultSize: { w: number; h: number }
}

// Core panels registered by @nextjs/observe-ui
registerPanel(traceListPanel)
registerPanel(spanWaterfallPanel)
registerPanel(errorRateChartPanel)
registerPanel(serviceMapPanel)

// Plugin panels registered on import
// @nextjs/observe-debug registers its own on package load
```

### Plugin panel auto-discovery

```
@nextjs/observe-debug installed
  → package.json#observePanels: ["./dist/panels/*.schema.yaml"]
  → CLI discovers schemas on init
  → JSON Schema regenerated → IDE autocomplete updated
  → PanelRegistry populated at server start
  → Debug tab appears in dashboard automatically
```

### AI-generated ephemeral dashboards

ADK `ReportAgent` emits a YAML dashboard config as structured output:

```yaml
title: "Incident: high error rate 34%"
ephemeral: true
expiresIn: 1h
panels:
  - id: affected
    type: trace-list
    position: { x: 0, y: 0, w: 12, h: 6 }
    config:
      traceIds: [trace_01J8X, trace_01J8Y, trace_01J8Z]
  - id: report
    type: static-markdown
    position: { x: 0, y: 6, w: 12, h: 4 }
    config:
      content: |
        ## Root cause
        Timeout in PaymentService.charge — Stripe p99 > 3000ms.
```

Saved to storage, linked from Telegram message. Expires automatically.

### CLI commands

```bash
npx nextjs-observe dashboard validate dashboards/traces.yaml
npx nextjs-observe dashboard push ./dashboards/        # GitOps sync
npx nextjs-observe panel list                          # all registered types + source package
npx nextjs-observe panel create my-panel               # scaffold schema.yaml + tsx
```

---

## AI Copilot — panel registry as DSL

The panel registry is not just a rendering mechanism — it is a **constrained vocabulary for AI**. Instead of asking AI to generate React components (expensive, unpredictable, unvalidatable), you give AI the registry as a DSL and ask it to fill in a YAML template.

### Why DSL beats code generation

```
Code generation approach          DSL approach
──────────────────────────────    ──────────────────────────────
"write a React page for traces"   "fill this YAML schema"
300+ lines JSX + hooks + CSS      15 lines YAML
2000+ tokens output               ~40 tokens output
can hallucinate API names         can only use registered panels
output varies every time          output is schema-constrained
no validation before render       Zod validates before render
user can't easily edit            user edits YAML directly
```

### System prompt — the full DSL context (~150 tokens)

```yaml
available_panels:
  trace-list:
    config: { service?: string, hasError?: boolean, limit?: number=50 }
    emits:  { selected: { traceId: string, duration: number, status: number } }
  span-waterfall:
    config: { traceId: string }
  error-rate-chart:
    config: { service?: string, window?: string=1h }
  p99-latency-chart:
    config: { service?: string, window?: string=1h, threshold?: number }
  filter-bar:
    config: { fields: string[] }
  service-map:
    config: { highlight?: string }
  static-markdown:
    config: { content: string }

bindings: "{{ panelId.emittedField }}"
position: { x: 0-12, y: number, w: 1-12, h: number }
```

When `@nextjs/observe-debug` is installed, its panel types are appended to this prompt automatically — AI gains new vocabulary without prompt changes.

### User asks in natural language → AI outputs YAML

```
User: мне нужна страница с медленными трейсами OrdersService
```

```yaml
title: Slow traces — OrdersService
panels:
  - id: chart
    type: p99-latency-chart
    position: { x: 0, y: 0, w: 6, h: 3 }
    config: { service: OrdersService, window: 1h, threshold: 1000 }

  - id: list
    type: trace-list
    position: { x: 6, y: 0, w: 6, h: 3 }
    config: { service: OrdersService, minDurationMs: 1000, limit: 20 }

  - id: waterfall
    type: span-waterfall
    position: { x: 0, y: 3, w: 12, h: 8 }
    config: { traceId: "{{ list.selected.traceId }}" }
```

System validates YAML against panel schemas → renders immediately.

### Copilot UI flow

```
┌──────────────────────────────────────────────────┐
│  Dashboard                                 [+ AI] │
│                                                   │
│  > ошибки в PaymentService за последний час       │
│                                                   │
│  ← validate YAML → render panels                 │
│                                                   │
│  ┌─────────────┐  ┌────────────────────────────┐ │
│  │ Error Rate  │  │ Trace List                 │ │
│  │ 34% ██████ │  │ POST /checkout  891ms  500 │ │
│  └─────────────┘  └────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ Span Waterfall                               │ │
│  │ PaymentService.charge ████████████  891ms   │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  [Edit YAML]  [Save dashboard]  [Discard]        │
└──────────────────────────────────────────────────┘
```

After render the user can press **Edit YAML** — sees exactly what AI generated, edits, saves. Full transparency and control.

### DSL auto-updates as panels are added

```
Developer adds new panel type
  → writes new-panel.schema.yaml
  → build generates Zod + TS types
  → CLI regenerates JSON Schema (IDE autocomplete)
  → panel type appended to AI system prompt automatically
  → AI can now generate dashboards using the new panel
  → no prompt engineering required
```

This is the compounding effect: every new panel type simultaneously extends what users can ask for and what AI can generate, with zero additional integration work.

### Workshop lesson — AI-friendly API design

```
Bad:  give AI an open canvas → "write code"
      high tokens, hallucinations, unvalidatable

Good: give AI a constrained vocabulary → "fill the schema"
      low tokens, schema-bounded, validated before use

Principle: the smaller the AI vocabulary, the more precise the output.

Real-world examples:
  GitHub Actions    → workflow YAML as DSL
  Kubernetes        → resource manifests as DSL
  nextjs-observe    → panel registry as DSL
```

---

## Self-debugging layer — `nextjs-observe-debug`

An optional package that adds AI-powered anomaly detection and root cause analysis on top of the existing storage layer. The key design principle: it reads from the **same `StorageAdapter`** — no external dependencies, no Jaeger API, no separate data pipeline.

```
┌─────────────────────────────────────────────────────────────────┐
│  nextjs-observe-debug  (optional package)                       │
│                                                                 │
│  Anomaly Detector  ─── setInterval(interval)                   │
│    polls StorageAdapter.queryTraces() every 30s                 │
│    checks: errorRate, p99Latency, noTraffic                     │
│    on threshold breach → fires AnomalyReport                    │
│                                                                 │
│  ADK Orchestrator  ─── triggered by AnomalyReport              │
│    LatencyAgent   → queryTraces({ minDurationMs, limit })       │
│    ErrorAgent     → queryTraces({ hasError: true, limit })      │
│    TrafficAgent   → queryTraces({ from, to, group: 'service' }) │
│    ReportAgent    → synthesizes root cause + recommendations     │
│    all tools → StorageAdapter.queryTraces() (no HTTP calls)     │
│                                                                 │
│  Debug Reporter  ─── receives DebugReport from ReportAgent     │
│    TelegramReporter   → Telegram Bot API                        │
│    SlackReporter      → Slack webhook                           │
│    WebhookReporter    → any HTTP endpoint                       │
│    ConsoleReporter    → stdout (dev mode)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ reads via
                           ▼
                     StorageAdapter
                (same instance as server uses)
```

### Interfaces

```ts
interface DebugConfig {
  storage: StorageAdapter
  interval: number                  // ms, default 30_000
  thresholds: {
    errorRate: number               // default 0.2  (20% of requests)
    p99LatencyMs: number            // default 1000
    noTrafficWindowMs: number       // default 120_000
  }
  reporter: DebugReporter
  bot?: {
    enabled: boolean                // interactive Telegram/Slack bot
    allowedChatIds: number[]
  }
}

interface AnomalyReport {
  type: 'high_error_rate' | 'high_latency' | 'no_traffic'
  value: string                     // "error rate: 34%", "p99: 2340ms"
  traces: NormalizedSpan[]          // evidence — already normalized, no extra fetch
  detectedAt: Date
}

interface DebugReporter {
  send(report: DebugReport): Promise<void>
}

interface DebugReport {
  anomaly: AnomalyReport
  rootCause: string                 // ADK agent output
  affectedTraceIds: string[]
  recommendations: string[]
  detectedAt: Date
}
```

### ADK agent tools

Two tool groups per agent — telemetry from `StorageAdapter`, code from GitHub API.

```ts
// Telemetry tools (always available)
const searchTraces = tool({
  name: 'search_traces',
  execute: async ({ minDurationMs, hasError, service, limit }) =>
    storage.queryTraces({ minDurationMs, hasError, service, limit,
      from: new Date(Date.now() - 5 * 60 * 1000) }),
})

const getMetrics = tool({
  name: 'get_metrics',
  execute: async ({ service, window }) =>
    storage.queryMetrics({ service, from: new Date(Date.now() - window) }),
})

// GitHub tools (available when github config provided)
const readFile = tool({
  name: 'read_file',
  execute: async ({ path }) =>
    github.repos.getContent({ owner, repo, path }),
})

const searchCode = tool({
  name: 'search_code',
  execute: async ({ query }) =>
    github.search.code({ q: `${query} repo:${owner}/${repo}` }),
})

const getRecentCommits = tool({
  name: 'get_recent_commits',
  execute: async ({ path, since }) =>
    github.repos.listCommits({ owner, repo, path, since }),
})

const createIssue = tool({
  name: 'create_issue',
  execute: async ({ title, body, labels }) => {
    const fingerprint = hashFingerprint(title)
    const existing = await github.issues.listForRepo({
      owner, repo, state: 'open', labels: 'observability'
    }).then(issues => issues.find(i => i.body?.includes(fingerprint)))
    if (existing) return { url: existing.html_url, created: false }
    const issue = await github.issues.create({ owner, repo, title, body, labels })
    return { url: issue.html_url, created: true }
  },
})
```

### GitHub integration — full analysis cycle

```
Anomaly: high error rate 34% in PaymentService — 14:23

ADK ErrorAgent:
  1. search_traces({ hasError: true, service: 'PaymentService' })
     → stack traces with file:line references

  2. read_file('src/services/payment.service.ts')
     → full file, understands full context around error

  3. get_recent_commits({ path: 'src/services/payment.service.ts',
                          since: '2h ago' })
     → commit abc123, 13:58 by @john
        "increase Stripe retry count to 5"

  4. (optionally) read_file at ref=abc123~1 to see what changed

ADK ReportAgent:
  → "Regression in commit abc123 by @john (25 min before incident).
     Added 5 retries without timeout — at 100 RPS each request blocks
     up to 150s, exhausting the connection pool."
  → create_issue (deduplication check first)
```

### GitHub issue auto-created

```markdown
## 🚨 Payment error rate 34% — likely regression

**Commit**: abc123 by @john · 25 min before incident
**Change**: retry count 1→5 without timeout

### What changed
- await stripe.paymentIntents.create({ amount })
+ await retry(() => stripe.paymentIntents.create({ amount }), { times: 5 })

### Why it breaks under load
5 retries × 30s default timeout = 150s max.
At 100 RPS → connection pool exhausted → cascade.

### Fix
  stripe.paymentIntents.create({ amount }, { timeout: 2000 })

**Traces**: [view 12 affected](https://observe.myapp.com/debug/xyz)
<!-- fingerprint:sha256:abc... — used for deduplication -->
```

### Configuration in `nextjs-observe.config.ts`

```ts
import { defineConfig } from '@nextjs/observe'
import { TelegramReporter } from '@nextjs/observe-debug'

export default defineConfig({
  serviceName: 'my-app',
  endpoint: process.env.OBSERVE_ENDPOINT!,
  apiKey: process.env.OBSERVE_API_KEY!,

  sourceContext: {            // fallback if GitHub not connected
    linesOfContext: 5,
    maxFrames: 5,
    sourceMaps: true,
  },

  debug: {
    enabled: true,
    interval: 30_000,
    thresholds: {
      errorRate: 0.2,
      p99LatencyMs: 1000,
      noTrafficWindowMs: 120_000,
    },
    reporter: new TelegramReporter({
      token: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    }),
    bot: {
      enabled: true,
      allowedChatIds: [123456789],
    },
    github: {                 // OAuth token from dashboard Settings → Integrations
      token: process.env.GITHUB_TOKEN!,
      owner: 'my-org',
      repo: 'my-app',
      branch: 'main',
      issueLabels: ['bug', 'observability'],
      deduplicationWindow: '24h',
    },
  },
})
```

### GitHub OAuth flow — dashboard Settings

```
Settings → Integrations
  GitHub   [Connect]
    → OAuth browser popup (scopes: repo:read, issues:write)
    → token stored encrypted in storage
    ◇ Repository: github.com/my-org/my-app
    ◇ Branch: main
    ✓ Connected — code analysis + issue creation enabled

  Linear   [Connect]   (future — via MCP server)
  Jira     [Connect]   (future — via MCP server)
```

### Code access — two-tier approach

```
GitHub connected               →  read full files + recent commits + create issues
GitHub not connected           →  sourceContext in SDK captures frames at error time
                                  (Sentry-style: 5 lines around each stack frame)
```

`sourceContext` is always captured by the SDK — it's cheap and works as fallback. When GitHub is connected, agents have full file access and commit history, which gives dramatically better root cause analysis.

### Dashboard — Debug tab

```
Trace Explorer | Metrics | Logs | Live Feed | Debug
```

Debug tab contents:
- Incident history — timestamp, type, value, status (active / resolved)
- Per-incident: root cause, agent reasoning, commit blame, GitHub issue link
- Bot status — active / inactive, last ping
- Integrations status — GitHub connected / scopes / repo
- Manual trigger — "Run analysis now" button

### Workshop → product mapping

```
Workshop (hands-on)                  nextjs-observe-debug (packaged)
────────────────────────────────────────────────────────────────────
Jaeger REST API              →       StorageAdapter.queryTraces()
GitHub API (manual)          →       readFile / searchCode / getRecentCommits tools
n8n scheduler                →       AnomalyDetector (built-in setInterval)
n8n Code node (thresholds)   →       thresholds config in defineConfig()
ADK agents                   →       ADK Orchestrator
Telegram node in n8n         →       TelegramReporter
GitHub node / manual         →       createIssue tool (deduplication built-in)
Two n8n workflows            →       one package, one config block
```

Participants build the pieces by hand with visible "LEGO bricks". At the end: show the same bricks packaged into `@nextjs/observe-debug` — one `npm install`, one config block.

---

## Data federation layer — `@nextjs/observe-sources`

The dashboard aggregates data from multiple external systems alongside its own storage. Two directions: **fan-out** (SDK sends OTel to multiple backends) and **federation** (dashboard reads from external APIs).

### Fan-out — OTel to multiple destinations

```ts
// defineConfig — multiple exporters, all receive the same spans
defineConfig({
  serviceName: 'my-app',
  exporters: [
    {
      type: 'nextjs-observe',          // primary — our server
      endpoint: process.env.OBSERVE_ENDPOINT!,
      apiKey: process.env.OBSERVE_API_KEY!,
    },
    {
      type: 'dynatrace',               // performance → Dynatrace
      endpoint: 'https://xxx.live.dynatrace.com/api/v2/otlp/v1/traces',
      apiToken: process.env.DT_API_TOKEN!,
    },
    {
      type: 'otlp',                    // any OTLP-compatible endpoint
      endpoint: 'http://jaeger:4318',
    },
  ],
})
```

Internally: one `NodeTracerProvider` with one `BatchSpanProcessor` per exporter. Standard OTel — no custom code, just config parsing.

### Federation — DataSourceAdapter interface

```ts
interface DataSourceAdapter {
  type: string
  query(params: DataSourceQuery): Promise<DataSourceResult>
}

interface DataSourceQuery {
  metric: string
  from: Date
  to: Date
  dimensions?: Record<string, string>
}

// Built-in adapters in @nextjs/observe-sources:
class DynatraceAdapter     implements DataSourceAdapter { }  // Dynatrace Metrics API v2
class YandexMetricaAdapter implements DataSourceAdapter { }  // Yandex Metrica API
class GA4Adapter           implements DataSourceAdapter { }  // Google Analytics Data API
class SentryAdapter        implements DataSourceAdapter { }  // Sentry API
class PrometheusAdapter    implements DataSourceAdapter { }  // PromQL
class InternalAdapter      implements DataSourceAdapter { }  // our own StorageAdapter
```

### Credential storage — encrypted in StorageAdapter

```ts
// StorageAdapter extended with credentials:
interface StorageAdapter {
  // ... existing methods ...
  saveCredential(cred: StoredCredential): Promise<void>
  getCredential(id: string): Promise<StoredCredential | null>
  listCredentials(): Promise<StoredCredential[]>
  deleteCredential(id: string): Promise<void>
}

interface StoredCredential {
  id: string
  sourceType: 'dynatrace' | 'yandex-metrica' | 'ga4' | 'sentry' | 'prometheus'
  label: string                       // user-defined: "Production DT"
  encrypted: string                   // AES-256-GCM(token, OBSERVE_ENCRYPTION_KEY)
  config: Record<string, string>      // non-sensitive: tenant URL, project ID
  createdAt: Date
}
```

Encryption key from `OBSERVE_ENCRYPTION_KEY` env var — never stored in DB.

### New panel schema YAML files (shipped in `@nextjs/observe-sources`)

```yaml
# data-source-metric.schema.yaml — single metric from external source
type: data-source-metric
package: "@nextjs/observe-sources"
config:
  source:
    type: string
    label: Data source ID (configured in Settings → Data Sources)
  metric:
    type: string
  window:
    type: string
    default: 1h
  display:
    type: enum
    values: [stat, line-chart, bar-chart]
    default: stat
defaultSize: { w: 4, h: 3 }
```

```yaml
# correlation-chart.schema.yaml — multiple series from different sources
type: correlation-chart
package: "@nextjs/observe-sources"
config:
  window:
    type: string
    default: 1h
  series:
    type: array
    items:
      source: string        # data source id or 'internal'
      metric: string
      label: string
      axis:
        type: enum
        values: [left, right]
        default: left
      color:
        type: string
        optional: true
defaultSize: { w: 12, h: 4 }
```

```yaml
# data-source-table.schema.yaml — tabular data from external source
type: data-source-table
package: "@nextjs/observe-sources"
config:
  source:
    type: string
  query:
    type: string
  limit:
    type: number
    default: 20
  columns:
    type: array
    items: string
defaultSize: { w: 12, h: 5 }
```

### Dashboard config using federation panels

```yaml
# dashboards/unified.yaml — business + technical on one screen
title: Business + Performance
version: 1

panels:
  - id: conversion
    type: data-source-metric
    position: { x: 0, y: 0, w: 3, h: 2 }
    config:
      source: yandex-metrica
      metric: goal_conversion_rate
      window: 1h
      display: stat

  - id: revenue
    type: data-source-metric
    position: { x: 3, y: 0, w: 3, h: 2 }
    config:
      source: yandex-metrica
      metric: revenue
      window: 1h
      display: stat

  - id: p99
    type: data-source-metric
    position: { x: 6, y: 0, w: 3, h: 2 }
    config:
      source: internal
      metric: p99_latency_ms
      service: PaymentService
      display: stat

  - id: error-rate
    type: data-source-metric
    position: { x: 9, y: 0, w: 3, h: 2 }
    config:
      source: internal
      metric: error_rate
      display: stat

  - id: correlation
    type: correlation-chart
    position: { x: 0, y: 2, w: 12, h: 4 }
    config:
      window: 2h
      series:
        - source: yandex-metrica
          metric: purchase_conversion
          label: Conversion %
          axis: left
          color: "#22c55e"
        - source: internal
          metric: p99_latency_ms
          service: PaymentService
          label: P99 Latency ms
          axis: right
          color: "#ef4444"

  - id: sentry-errors
    type: data-source-table
    position: { x: 0, y: 6, w: 6, h: 5 }
    config:
      source: sentry
      query: unresolved_errors
      limit: 10
      columns: [title, count, lastSeen]

  - id: traces
    type: trace-list
    position: { x: 6, y: 6, w: 6, h: 5 }
    config:
      hasError: true
      limit: 10
```

### The killer insight — correlation at a glance

```
14:23 ──────────────────────────────────────────────────────────
  Yandex Metrica:    conversion  34% → 22%     ← business signal
  Dynatrace:         CPU         45% → 92%     ← infra signal
  nextjs-observe:    p99         340 → 2340ms  ← our trace

Without federation: three browser tabs, manual correlation
With federation:    one timeline, one screen, cause visible instantly
```

### Dashboard — Settings → Data Sources

```
Settings → Data Sources                          [+ Add Source]

  Dynatrace       Production DT    ✓ Connected
  tenant: xxx.live.dynatrace.com   scopes: metrics.read    [Edit] [Del]

  Yandex Metrica  Main site        ✓ Connected
  counter_id: 12345678                                      [Edit] [Del]

  Sentry          my-org           ✓ Connected
  projects: my-app                                          [Edit] [Del]

  GA4             Marketing        ✓ Connected
  property_id: 987654321                                    [Edit] [Del]
```

### Package structure

```
packages/
  sdk/        @nextjs/observe           fan-out exporters config
  server/     nextjs-observe-server     StorageAdapter + credentials table
  ui/         nextjs-observe-ui         Settings → Data Sources UI
  sources/    @nextjs/observe-sources   DataSourceAdapter + adapters + panel schemas
  debug/      @nextjs/observe-debug     anomaly detection + GitHub
  cli/        nextjs-observe            CLI wizard
```

---

## Public SDK API

```ts
// Config (nextjs-observe.config.ts)
import { defineConfig } from '@nextjs/observe'
export default defineConfig({
  serviceName: 'my-app',
  endpoint: process.env.OBSERVE_ENDPOINT!,
  apiKey: process.env.OBSERVE_API_KEY!,
  sampling: { rate: 1.0 },
  redaction: { keys: ['password', 'token', 'secret'] },
})

// Route handler wrapper
export const GET = withObserve(async (req: NextRequest) => { ... })

// Server Action wrapper
const createOrder = withObserveAction(async (data: FormData) => { ... })

// BullMQ job wrapper
new Worker('queue', withObserveWorker(async (job) => { ... }), opts)

// Manual span
const result = await observe.span('operation-name', async (span) => {
  span.setAttribute('key', 'value')
  return doWork()
})

// Access current context
observe.currentTraceId()       // string | null
observe.setAttribute('k', 'v') // on current span
```

---

## Configuration reference

### SDK options (`defineConfig`)

| Option | Type | Default | Description |
|---|---|---|---|
| `serviceName` | string | required | OTel `service.name` resource attribute |
| `endpoint` | string | required | nextjs-observe-server URL |
| `apiKey` | string | required | API key for auth |
| `serviceVersion` | string | `'0.0.0'` | OTel `service.version` |
| `sampling.rate` | 0–1 | `1.0` | Trace sampling rate |
| `redaction.keys` | string[] | `[]` | Attribute keys to redact |
| `redaction.patterns` | RegExp[] | built-ins | Patterns to redact from values |
| `bullmq.propagate` | boolean | `true` | Auto-inject trace context into BullMQ jobs |

### Server env vars

| Var | Required | Description |
|---|---|---|
| `OBSERVE_API_KEY` | yes | API key to validate incoming requests |
| `OBSERVE_STORAGE` | yes | `supabase` / `mongodb` / `clickhouse` / `sqlite` |
| `OBSERVE_BROKER` | yes | `bullmq` / `redis-streams` / `kafka` / `memory` |
| `DATABASE_URL` | yes | Connection string for chosen storage |
| `REDIS_URL` | if broker≠memory | Redis connection string |
| `OBSERVE_RETENTION_DAYS` | no | Default: `30` |
| `OBSERVE_PORT` | no | Default: `4318` |
