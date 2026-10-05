# Features: Telemetry Routing + Infrastructure Cost Tracking

> **Статус на 2026-10-05.** Текст ниже написан под старую архитектуру (`@nextjs/observe-debug`, `defineConfig()`, streamUI) и оставлен как исходная идея. Актуальное состояние и порядок работ — в этом блоке.
>
> **Feature 1 — маршрутизация.**
> - Для traces **сделано**: каждый спан уходит и в обзервер (`OBSERVE_*`), и во внешний бэкенд (`OTEL_EXPORTER_OTLP_*`, в том числе `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`), каждому свои заголовки. «Dynatrace рядом с обзервером, две строчки в `.env`» работает.
> - Metrics и logs `next-observe` пока **не отправляет** — маршрутизировать нечего. Когда появятся, берём стандартные `OTEL_EXPORTER_OTLP_{METRICS,LOGS}_ENDPOINT`, а не свои `METRICS_ENDPOINT` / `LOGS_ENDPOINT`.
>
> **Feature 2 — стоимость.** В описанном виде не делаем:
> - в демо приложение на Vercel, дроплет держит только обзервер; у участников всё на ноутбуках — считать нечего;
> - `process.cpuUsage()` — это процесс Node, а не сервер; веса 70/30 произвольны; совет «перейдите на тариф дешевле» при низкой средней загрузке вреден (запас нужен под пики) — это противоречит правилу «факты только из данных»;
> - нужен конвейер метрик, которого нет.
>
> Вместо этого — **«сколько стоит каждый маршрут»**, только из трейсов: обзерверу задают `--monthly-usd 20`, он делит сумму по доле серверного времени маршрутов. Пример: «`POST /api/checkout` — 62% серверного времени, $12.4 из $20 в месяц; после v2 доля выросла с 18%».
>
> **Порядок работ:**
>
> | № | Что | Когда |
> |---|-----|-------|
> | 1 | Шаги 50–53: страница операции, собственное/полное время и критический путь в трейсе, ошибки-дефекты, промпт для coding-агента | сейчас |
> | 2 | Надёжность воркшопа: повтор при 429 и зависшем вызове модели, офлайн-установка, Windows | до воркшопа, обязательно |
> | 3 | Стоимость по маршрутам из трейсов (`--monthly-usd`) | до воркшопа, если останется время — финал демо |
> | 4 | Логи с привязкой к трейсу + стандартные адреса по сигналам | после воркшопа |
> | 5 | Метрики рантайма (CPU, память, event loop), стоимость по загрузке сервера, цены через API провайдера | после воркшопа |

Два независимых feature, оба входят в `@nextjs/observe-debug`.  
Описание для реализации в Claude Code.

---

## Feature 1 — Multi-endpoint telemetry routing

### Идея

Traces, metrics и logs имеют разные характеристики хранения и разные инструменты которые их понимают лучше. Нет смысла слать всё в одно место если у тебя уже есть Prometheus для метрик и Loki для логов.

### Что делаем

Расширяем `defineConfig()` — вместо одного `endpoint` можно задать разные endpoints для разных типов сигналов:

```ts
export default defineConfig({
  serviceName: 'my-app',

  // Вариант A — один endpoint для всего (текущее поведение)
  endpoint: process.env.OTEL_ENDPOINT,

  // Вариант B — разные endpoints по типу
  endpoints: {
    traces:  process.env.TRACES_ENDPOINT,   // Jaeger / Dynatrace / Tempo
    metrics: process.env.METRICS_ENDPOINT,  // Prometheus / Victoria / Mimir
    logs:    process.env.LOGS_ENDPOINT,     // Loki / Elasticsearch / S3
  },

  // Вариант C — один основной + переопределения
  endpoint: process.env.OTEL_ENDPOINT,
  endpoints: {
    logs: process.env.LOGS_ENDPOINT,   // логи отдельно, остальное в default
  }
})
```

### Приоритет разрешения

```
endpoints.traces ?? endpoint ?? OTEL_EXPORTER_OTLP_ENDPOINT
endpoints.metrics ?? endpoint ?? OTEL_EXPORTER_OTLP_ENDPOINT
endpoints.logs    ?? endpoint ?? OTEL_EXPORTER_OTLP_ENDPOINT
```

### Реализация в SDK

В `register()` создаём отдельный exporter для каждого типа:

```ts
// instrumentation.ts → register()

const resolveEndpoint = (type: 'traces' | 'metrics' | 'logs') =>
  config.endpoints?.[type] ?? config.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT

// Traces
const traceExporter = new OTLPTraceExporter({
  url: `${resolveEndpoint('traces')}/v1/traces`,
  headers: { 'x-api-key': config.apiKey }
})

// Metrics
const metricExporter = new OTLPMetricExporter({
  url: `${resolveEndpoint('metrics')}/v1/metrics`,
  headers: { 'x-api-key': config.apiKey }
})

// Logs
const logExporter = new OTLPLogExporter({
  url: `${resolveEndpoint('logs')}/v1/logs`,
  headers: { 'x-api-key': config.apiKey }
})
```

### Агрегация на стороне observe-debug

Если данные разбросаны по разным системам — агентам нужны разные tools. Но мы не хотим усложнять.

Решение: агрегация происходит в `observe-server` до записи в storage. Независимо от того куда ты экспортируешь данные снаружи — внутри продукта всё идёт через единый `StorageAdapter`. Routing — это про внешние destinations, не про внутреннюю архитектуру.

```
Next.js SDK
  ├── OTLPTraceExporter  → внешний Dynatrace (для твоей команды)
  ├── OTLPMetricExporter → внешний Prometheus (для девопсов)
  └── OTLPLogExporter    → внешний Loki (для девопсов)
  └── OTLPTraceExporter  → observe-server (для observe-debug агентов)
         ↓
    StorageAdapter (SQLite / Supabase / ClickHouse)
         ↓
    ADK агенты читают отсюда
```

Участник может одновременно слать в Dynatrace для своей команды и в observe-server для AI агентов. Два destinations для traces — это нормально для OTel.

### .env.example additions

```bash
# Multi-endpoint routing (опционально)
TRACES_ENDPOINT=https://{env}.live.dynatrace.com/api/v2/otlp
METRICS_ENDPOINT=http://localhost:9090  # Prometheus
LOGS_ENDPOINT=http://localhost:3100     # Loki

# observe-server всегда локально
OBSERVE_ENDPOINT=http://localhost:4318
```

### Для воркшопа

Один слайд в теории — схема с тремя стрелками в разные destinations.  
Один абзац: "OTel Collector делает то же самое — но мы убрали его из стека для простоты."  
В финале: показываешь как добавить Dynatrace endpoint рядом с observe-server — две строчки в `.env`.

---

## Feature 2 — Infrastructure cost tracking

### Идея

Observability обычно отвечает на "что сломалось и почему". Этот feature добавляет ответ на "сколько это стоит".

Не стоимость одного трейса — а соотношение реальной нагрузки к оплаченной мощности VPS/дроплета. Агент видит не только перформанс но и деньги.

### Концепция

```
VPS $20/month = $0.028/hour
  CPU: 2 cores
  Memory: 4GB

Текущая нагрузка (из Node.js process metrics):
  CPU usage: 15% average
  Memory: 40% average

Cost efficiency = фактическое использование / оплаченная мощность
  = 0.15 (15%) → ты платишь $20 но используешь ~$3 worth

В часы пик (14:00-16:00 UTC):
  CPU: 80% → efficiency 0.8 → нормально
  Остальные 22 часа: efficiency < 0.15 → переплата 6x
```

### defineConfig() additions

```ts
export default defineConfig({
  serviceName: 'my-app',
  endpoint: process.env.OBSERVE_ENDPOINT,

  // Новая секция
  infrastructure: {
    // Вариант A — ручной ввод
    provider: 'digitalocean',  // hetzner | aws | fly | railway | render | manual
    monthlyUSD: 20,
    specs: {
      cpu: 2,          // cores
      memoryGB: 4,
      bandwidthTB: 2   // опционально
    },

    // Вариант B — автоматически через provider API (future)
    // provider: 'digitalocean'
    // apiKey: process.env.DO_API_KEY
    // dropletId: process.env.DO_DROPLET_ID
    // → стоимость и specs подтягиваются автоматически
  }
})
```

### Что собираем

Node.js process metrics уже есть в OTel из коробки:

```ts
// Уже собирается @opentelemetry/sdk-node
process.memoryUsage()          // heapUsed, heapTotal, rss
process.cpuUsage()             // user, system microseconds
```

Добавляем расчёт cost efficiency как кастомную метрику:

```ts
// В observe-server, периодически (каждые 30s)
function calculateCostEfficiency(config: InfrastructureConfig): CostMetrics {
  const hourlyRate = config.monthlyUSD / 730  // часов в месяце

  // Из последних span metrics
  const cpuUsage    = getAverageCpuUsage(last5min)
  const memoryUsage = getAverageMemoryUsage(last5min)

  // Взвешенный efficiency (CPU 70%, memory 30%)
  const efficiency = cpuUsage * 0.7 + memoryUsage * 0.3

  return {
    efficiencyPercent: efficiency * 100,
    actualCostPerHour: hourlyRate * efficiency,
    paidCostPerHour:   hourlyRate,
    wastedCostPerHour: hourlyRate * (1 - efficiency),
    projectedMonthlyWaste: hourlyRate * (1 - efficiency) * 730
  }
}
```

### Как агенты это используют

Новый tool для всех агентов:

```ts
const getCostMetrics = tool({
  name: 'get_cost_metrics',
  description: 'Get infrastructure cost efficiency and waste metrics',
  parameters: z.object({
    windowMinutes: z.number().default(60)
  }),
  execute: async ({ windowMinutes }) => {
    return storage.queryCostMetrics({ windowMinutes })
  }
})
```

Report Agent добавляет cost context в каждый отчёт:

```
RootCauseCard:
  ⚠️  High latency: chargePayment p99 2.8s
  📍  Root cause: external payment provider degradation
  💰  Infrastructure efficiency: 12% ($17.60/mo wasted)
      Peak hours 14-16 UTC: 80% efficient
      Consider: downgrade to $10 plan or increase traffic
```

### Новый компонент — CostCard

```tsx
// debug/chat/components/CostCard.tsx

interface CostCardProps {
  efficiencyPercent: number
  paidMonthly: number
  wastedMonthly: number
  peakHours?: string
  suggestion?: string
}

export function CostCard({
  efficiencyPercent,
  paidMonthly,
  wastedMonthly,
  peakHours,
  suggestion
}: CostCardProps) {
  const color = efficiencyPercent > 60 ? 'green' : 
                efficiencyPercent > 30 ? 'yellow' : 'red'
  return (
    <div className="cost-card">
      <div className="efficiency-bar" style={{ color }}>
        {efficiencyPercent.toFixed(0)}% efficient
      </div>
      <div className="breakdown">
        <span>Paying: ${paidMonthly}/mo</span>
        <span>Wasting: ${wastedMonthly.toFixed(2)}/mo</span>
      </div>
      {peakHours && <div>Peak: {peakHours}</div>}
      {suggestion && <div className="suggestion">💡 {suggestion}</div>}
    </div>
  )
}
```

### streamUI addition

```ts
// В investigateAnomaly() и askAgent()
showCostCard: {
  description: 'Render infrastructure cost efficiency card',
  parameters: z.object({
    efficiencyPercent: z.number(),
    paidMonthly: z.number(),
    wastedMonthly: z.number(),
    peakHours: z.string().optional(),
    suggestion: z.string().optional()
  }),
  generate: async (props) => <CostCard {...props} />
}
```

### Хранение в StorageAdapter

Новый метод в интерфейсе:

```ts
interface StorageAdapter {
  // существующие методы...
  insertCostMetrics(metrics: CostMetrics): Promise<void>
  queryCostMetrics(filter: { windowMinutes: number }): Promise<CostMetrics[]>
}
```

Считается в observe-server каждые 30 секунд, хранится как time series.

### Для воркшопа

Не показываем детали реализации — это слишком глубоко для 3.5 часов.

Показываем результат в финальном демо:

```
"Агент нашёл медленный checkout.
 И заодно сказал что вы платите $20 в месяц
 но используете только 12% мощности."
```

Один слайд в итоге: "Observability не только про перформанс — про деньги тоже."

---

## Приоритеты реализации

| Feature | Сложность | Нужно до воркшопа |
|---------|-----------|-------------------|
| Multi-endpoint routing | Низкая — конфиг + три exporter | Да — показываем Dynatrace как альтернативу |
| Cost tracking (manual config) | Средняя — метрики + расчёт + CostCard | Да — wow момент в финальном демо |
| Cost tracking (auto API) | Высокая — интеграция с DO/AWS API | Нет — Sprint 10+ |

---

## Зависимости между features

Multi-endpoint routing не зависит от cost tracking.  
Cost tracking не зависит от multi-endpoint routing.  
Оба зависят от Sprint 9 (observe-debug + streamUI) который должен быть готов первым.
