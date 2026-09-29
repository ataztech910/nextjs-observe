# Tech Stack

## Monorepo

| Tool | Why |
|---|---|
| **Turborepo** | Build caching, parallel task execution, Next.js ecosystem native |
| **pnpm workspaces** | Fast installs, strict dependency isolation |
| **TypeScript** | Strict, ESM, `"type": "module"` throughout |
| **Vitest** | Fast, native ESM, compatible with SWC decorator metadata (needed for DI) |
| **oxlint** | Rust-based linter, fast |

---

## SDK — `@nextjs/observe`

### Core OTel packages

| Package | Role |
|---|---|
| `@opentelemetry/api` | Stable public API — spans, context, propagation. Works in Node.js, Edge, Browser |
| `@opentelemetry/sdk-node` | Node.js TracerProvider + auto-instrumentations |
| `@opentelemetry/sdk-trace-web` | Browser TracerProvider |
| `@opentelemetry/sdk-trace-base` | Shared: BatchSpanProcessor, SimpleSpanProcessor |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP/HTTP exporter — points at nextjs-observe-server |
| `@opentelemetry/resources` | Service name, version, deployment.environment |
| `@opentelemetry/semantic-conventions` | Standard attribute name constants |

### Auto-instrumentation packages

| Package | What it instruments |
|---|---|
| `@opentelemetry/instrumentation-http` | Node.js `http`/`https` module |
| `@opentelemetry/instrumentation-fetch` | `globalThis.fetch` (Node.js + Browser) |
| `@opentelemetry/instrumentation-undici` | `undici` (Next.js internal HTTP client) |
| `@opentelemetry/instrumentation-document-load` | Browser page navigation timing |

### Next.js integration

| Entry point | Runtime | What happens |
|---|---|---|
| `instrumentation.ts` → `register()` | Node.js + Edge | OTel SDK init, monkey-patches |
| `instrumentation-client.ts` | Browser | WebTracerProvider init (auto-bundled by Next.js 15+) |

### Monkey-patches applied in `register()`

```
globalThis.fetch          →  inject traceparent header, create outgoing span
node:http / node:https    →  same
React.cache               →  preserve AsyncLocalStorage context across cache boundary
Queue.prototype.add       →  inject trace context into BullMQ job data
```

### Edge Runtime I/O strategy

```
after() from next/server  →  runs after response sent, sends spans via fetch
```
No worker_threads, no SharedArrayBuffer on Edge — direct fetch to collector.

### Peer dependencies

```
next >= 15.0.0
react >= 19.0.0
bullmq >= 5.0.0   (optional — only if using withObserveWorker)
```

---

## Server — `nextjs-observe-server`

| Layer | Technology | Why |
|---|---|---|
| HTTP server | **Fastify** | Fast, TypeScript native, schema validation built-in |
| OTLP protocol | `/v1/traces` `/v1/metrics` `/v1/logs` | Standard OTel collector endpoints, any OTel SDK works |
| Auth | API Key in `x-api-key` header | Simple, stateless, like @nestjs/observe |
| Validation | `@fastify/type-provider-typebox` | TypeBox schemas, zero runtime overhead |

### Storage adapters

| Adapter | Use case | Free tier |
|---|---|---|
| **Supabase** (PostgreSQL) | Dev, small teams, SQL analytics, realtime dashboard | 500MB |
| **MongoDB Atlas** | Traces as documents, TTL indexes, change streams | 512MB |
| **ClickHouse** | High-volume analytics, best compression, fastest aggregations | ClickHouse Cloud 1TB compute/mo |
| **SQLite** (via Turso/better-sqlite3) | Local dev, zero config, Tier 0 | Turso 9GB |

### Broker adapters

| Adapter | Use case | Free tier |
|---|---|---|
| **BullMQ + Redis** | Recommended — retries, priorities, Bull Board UI | Upstash Redis 10k req/day |
| **Redis Streams** | Higher raw throughput, simpler | Same |
| **Kafka** | >10k RPS, enterprise, multi-consumer | Upstash Kafka 10k msg/day |
| **InMemory** | Dev/Lite, direct write | — |

### BullMQ queue configuration

```
Queue: 'telemetry'
  Job: 'spans'   priority: 3
  Job: 'errors'  priority: 1  ← highest, processed first
  Job: 'metrics' priority: 4
  Job: 'logs'    priority: 5
```

### StorageAdapter interface

```ts
interface StorageAdapter {
  insertSpans(spans: Span[]): Promise<void>
  queryTraces(filter: TraceFilter): Promise<Trace[]>
  queryMetrics(filter: MetricFilter): Promise<Metric[]>
  queryLogs(filter: LogFilter): Promise<LogEntry[]>
  purgeOlderThan(days: number): Promise<void>
}
```

### BrokerAdapter interface

```ts
interface BrokerAdapter {
  publish(topic: TelemetryTopic, payload: Buffer, opts?: PublishOptions): Promise<void>
  subscribe(topic: TelemetryTopic, handler: JobHandler): void
}
type TelemetryTopic = 'spans' | 'errors' | 'metrics' | 'logs'
```

### ClickHouse schema (traces)

```sql
CREATE TABLE spans (
  trace_id       String,
  span_id        String,
  parent_span_id String,
  service_name   LowCardinality(String),
  operation      String,
  start_time     DateTime64(9),
  duration_ns    UInt64,
  status_code    UInt8,
  attributes     Map(String, String),
  resource       Map(String, String),
  INDEX idx_trace trace_id TYPE bloom_filter GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toDate(start_time)
ORDER BY (service_name, start_time, trace_id)
TTL start_time + INTERVAL 30 DAY;
```

---

## Dashboard — `nextjs-observe-ui`

| Technology | Why |
|---|---|
| **Next.js 15** | Dogfoods the SDK — the dashboard itself is instrumented |
| **Supabase Realtime** | Live trace feed via websockets (when Supabase adapter is used) |
| **tRPC** | Type-safe API between dashboard and server |
| **Recharts** | Metrics charts |
| **shadcn/ui** | UI components |

### Declarative panel system

| Tool | Why |
|---|---|
| **YAML panel schemas** | Each panel type declares its config, emits, defaultSize — machine-readable |
| **yaml-to-zod** | Generates Zod validators from panel schema YAML at build time |
| **JSON Schema export** | Generated from panel schemas — powers IDE autocomplete in dashboard YAML files |
| **Binding engine** | `{{ panel.selected.field }}` — reactive expressions linking panels without React wiring |
| **PanelRegistry** | Runtime registry — `registerPanel(def)` called by core + plugins |
| **PanelGrid** | CSS Grid layout engine — renders `DashboardConfig` YAML into positioned panels |

### Two YAML file types

**Panel schema** (`*.schema.yaml`) — written by panel/plugin authors, ships inside npm packages:
```yaml
type: trace-list
label: Trace List
config:
  service:
    type: string
    optional: true
  limit:
    type: number
    default: 50
emits:
  selected:
    traceId: string
    duration: number
defaultSize:
  w: 12
  h: 6
```

**Dashboard config** (`dashboards/*.yaml`) — written by users or generated by AI:
```yaml
title: Traces
version: 1
panels:
  - id: list
    type: trace-list
    position: { x: 0, y: 0, w: 8, h: 6 }
    config:
      limit: 50
  - id: waterfall
    type: span-waterfall
    position: { x: 0, y: 6, w: 12, h: 8 }
    config:
      traceId: "{{ list.selected.traceId }}"
```

### Plugin panel registration

Plugins ship their own `*.schema.yaml` files. When the package is installed, schemas are auto-discovered and registered — new panel types appear in the UI without any changes to the dashboard codebase.

```
@nextjs/observe-debug installs
  → incident-list.schema.yaml discovered
  → root-cause-report.schema.yaml discovered
  → Debug tab appears automatically in dashboard
```

### IDE integration

```json
// .vscode/settings.json (generated by CLI)
{
  "yaml.schemas": {
    "./node_modules/@nextjs/observe-ui/schemas/dashboard.schema.json": "dashboards/*.yaml",
    "./node_modules/@nextjs/observe-ui/schemas/panel.schema.json":     "panels/*.schema.yaml"
  }
}
```

`type:` field in dashboard YAML autocompletes all registered panel types including those from plugins.

---

## CLI — `nextjs-observe`

| Technology | Why |
|---|---|
| **@clack/prompts** | Beautiful interactive prompts (like Astro, create-t3-app) |
| **execa** | Child process management for docker, git |
| **handlebars** | Template generation for configs |

### Generated files per target

| Target | Generated files |
|---|---|
| Docker Compose | `docker-compose.yml`, `.env.local`, `instrumentation.ts`, `nextjs-observe.config.ts` |
| Railway | `railway.json` |
| Fly.io | `fly.toml` |
| Kubernetes | `helm/values.yaml` |

---

## Distribution tiers

| Tier | Storage | Broker | Target |
|---|---|---|---|
| **0 — Zero config** | SQLite | InMemory | Local dev |
| **1 — Free cloud** | Supabase or MongoDB Atlas | BullMQ + Upstash Redis | Hobby / startup |
| **2 — Standard** | ClickHouse Cloud or self-hosted | BullMQ + Redis | Production team |
| **3 — Scale** | ClickHouse cluster | Kafka (Strimzi / MSK) | Enterprise |
| **Managed SaaS** | Internal ClickHouse | Internal | nextjs-observe.com |
