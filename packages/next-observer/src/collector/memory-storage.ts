// In-memory StorageAdapter: zero setup for `next-observer dev` and tests. Oldest spans are evicted past maxSpans.
import type {
  NormalizedSpan,
  OperationFilter,
  OperationStats,
  ServiceInfo,
  SpanFilter,
  StorageAdapter,
  TraceFilter,
  TraceSummary,
} from './types.js'
import { isFrameworkSpan } from './framework.js'

export interface MemoryStorageOptions {
  /** Default 100_000. */
  maxSpans?: number
}

// Nearest-rank percentile over an ascending array.
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const round = (n: number) => Math.round(n * 1000) / 1000
// Case-insensitive: agents and people type "payment", spans say "chargePayment".
const nameMatches = (name: string, query: string) => name.toLowerCase().includes(query.toLowerCase())

function summarize(traceId: string, spans: NormalizedSpan[]): TraceSummary {
  const ids = new Set(spans.map((s) => s.spanId))
  // Root = span whose parent isn't in this trace (true root, or the earliest orphan while spans still arrive).
  const roots = spans.filter((s) => !s.parentSpanId || !ids.has(s.parentSpanId))
  const root = roots.reduce((a, b) => (b.startTimeMs < a.startTimeMs ? b : a), roots[0] ?? spans[0])
  const start = Math.min(...spans.map((s) => s.startTimeMs))
  const end = Math.max(...spans.map((s) => s.startTimeMs + s.durationMs))
  return {
    traceId,
    rootName: root.name,
    rootService: root.service,
    services: [...new Set(spans.map((s) => s.service))].sort(),
    startTimeMs: start,
    durationMs: round(end - start),
    spanCount: spans.length,
    errorCount: spans.filter((s) => s.status === 'error').length,
  }
}

function firstRequestKey(span: NormalizedSpan): string | undefined {
  const instance = span.resource['service.instance.id']
  if (span.kind !== 'server' || typeof instance !== 'string') return undefined
  return `${span.service}\u0000${instance}\u0000${span.name}`
}

export class MemoryStorage implements StorageAdapter {
  private readonly spans: NormalizedSpan[] = []
  private readonly byTrace = new Map<string, NormalizedSpan[]>()
  // Earliest server span per (service, instance, route). Kept after eviction so a later request never becomes "cold".
  private readonly firstRequests = new Map<string, NormalizedSpan>()
  private readonly maxSpans: number

  constructor(options: MemoryStorageOptions = {}) {
    this.maxSpans = options.maxSpans ?? 100_000
  }

  async insertSpans(spans: NormalizedSpan[]): Promise<void> {
    for (const span of spans) {
      this.spans.push(span)
      const key = firstRequestKey(span)
      if (key) {
        const first = this.firstRequests.get(key)
        // Batches arrive out of order: an earlier request replaces the one seen first.
        if (!first || span.startTimeMs < first.startTimeMs) this.firstRequests.set(key, span)
      }
      const trace = this.byTrace.get(span.traceId)
      if (trace) trace.push(span)
      else this.byTrace.set(span.traceId, [span])
    }
    while (this.spans.length > this.maxSpans) {
      const evicted = this.spans.shift()!
      const trace = this.byTrace.get(evicted.traceId)!
      trace.splice(trace.indexOf(evicted), 1)
      if (trace.length === 0) this.byTrace.delete(evicted.traceId)
    }
  }

  async queryTraces(filter: TraceFilter = {}): Promise<TraceSummary[]> {
    const result: TraceSummary[] = []
    for (const [traceId, spans] of this.byTrace) {
      if (filter.service && !spans.some((s) => s.service === filter.service)) continue
      if (filter.operation && !spans.some((s) => nameMatches(s.name, filter.operation!))) continue
      const summary = summarize(traceId, spans)
      if (filter.hasError !== undefined && summary.errorCount > 0 !== filter.hasError) continue
      if (filter.minDurationMs !== undefined && summary.durationMs < filter.minDurationMs) continue
      if (filter.fromMs !== undefined && summary.startTimeMs < filter.fromMs) continue
      if (filter.toMs !== undefined && summary.startTimeMs > filter.toMs) continue
      result.push(summary)
    }
    return result.sort((a, b) => b.startTimeMs - a.startTimeMs).slice(0, filter.limit ?? 50)
  }

  // Waterfall order: by start time; on equal start a parent comes before its children (depth tie-break).
  async getTrace(traceId: string): Promise<NormalizedSpan[]> {
    const spans = this.byTrace.get(traceId) ?? []
    const byId = new Map(spans.map((s) => [s.spanId, s]))
    const depth = (s: NormalizedSpan) => {
      let d = 0
      for (let p = s.parentSpanId && byId.get(s.parentSpanId); p && d < spans.length; p = p.parentSpanId && byId.get(p.parentSpanId)) d++
      return d
    }
    return [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs || depth(a) - depth(b))
  }

  async getOperationStats(filter: OperationFilter = {}): Promise<OperationStats[]> {
    const groups = new Map<string, NormalizedSpan[]>()
    for (const s of this.spans) {
      if (filter.service && s.service !== filter.service) continue
      if (filter.operation && !nameMatches(s.name, filter.operation)) continue
      if (filter.hideFramework && isFrameworkSpan(s)) continue
      if (filter.fromMs !== undefined && s.startTimeMs < filter.fromMs) continue
      if (filter.toMs !== undefined && s.startTimeMs > filter.toMs) continue
      const key = filter.byVersion ? `${s.service}\u0000${s.serviceVersion}\u0000${s.name}` : `${s.service}\u0000${s.name}`
      const group = groups.get(key)
      if (group) group.push(s)
      else groups.set(key, [s])
    }
    const stats: OperationStats[] = []
    for (const group of groups.values()) {
      const warm = filter.hideColdStarts ? group.filter((s) => !this.isColdStart(s)) : group
      const spans = warm.length > 0 ? warm : group
      const coldStarts = group.length - warm.length
      const durations = spans.map((s) => s.durationMs).sort((a, b) => a - b)
      const errorCount = spans.filter((s) => s.status === 'error').length
      stats.push({
        service: spans[0].service,
        ...(filter.byVersion ? { serviceVersion: spans[0].serviceVersion } : {}),
        operation: spans[0].name,
        count: spans.length,
        errorCount,
        errorRate: round(errorCount / spans.length),
        avgMs: round(durations.reduce((a, b) => a + b, 0) / durations.length),
        p50Ms: round(percentile(durations, 50)),
        p95Ms: round(percentile(durations, 95)),
        p99Ms: round(percentile(durations, 99)),
        maxMs: round(durations[durations.length - 1]),
        ...(coldStarts > 0 ? { coldStarts, ...(warm.length === 0 ? { onlyColdStarts: true } : {}) } : {}),
      })
    }
    return stats.sort((a, b) => b.p95Ms - a.p95Ms)
  }

  async querySpans(filter: SpanFilter = {}): Promise<NormalizedSpan[]> {
    const result: NormalizedSpan[] = []
    const limit = filter.limit ?? 100
    for (let i = this.spans.length - 1; i >= 0 && result.length < limit; i--) {
      const s = this.spans[i]
      if (filter.service && s.service !== filter.service) continue
      if (filter.operation && !nameMatches(s.name, filter.operation)) continue
      if (filter.hideFramework && isFrameworkSpan(s)) continue
      if (filter.status && s.status !== filter.status) continue
      if (filter.fromMs !== undefined && s.startTimeMs < filter.fromMs) continue
      if (filter.toMs !== undefined && s.startTimeMs > filter.toMs) continue
      result.push(s)
    }
    return result
  }

  isColdStart(span: NormalizedSpan): boolean {
    const key = firstRequestKey(span)
    return key !== undefined && this.firstRequests.get(key) === span
  }

  async getServices(): Promise<ServiceInfo[]> {
    const services = new Map<string, ServiceInfo>()
    for (const s of this.spans) {
      const info = services.get(s.service) ?? { name: s.service, versions: [], spanCount: 0, lastSeenMs: 0, versionLastSeenMs: {} }
      info.spanCount++
      info.lastSeenMs = Math.max(info.lastSeenMs, s.startTimeMs)
      if (s.serviceVersion) {
        if (!info.versions.includes(s.serviceVersion)) info.versions.push(s.serviceVersion)
        info.versionLastSeenMs[s.serviceVersion] = Math.max(info.versionLastSeenMs[s.serviceVersion] ?? 0, s.startTimeMs)
      }
      services.set(s.service, info)
    }
    return [...services.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  async count(): Promise<number> {
    return this.spans.length
  }
}
