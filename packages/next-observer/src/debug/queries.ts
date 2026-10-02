// Agent tools as plain functions over the StorageAdapter — no LLM framework here, so they're testable on their own
// and any agent runtime (ADK today) wraps them in one line.
// Rules for every tool: compact, token-cheap output (aggregates, not raw spans), rounded numbers, and a `note`
// instead of an empty result when a name filter matches nothing (users say "checkout", spans say "chargePayment").
import { isFrameworkSpan } from '../collector/framework.js'
import type { NormalizedSpan, OperationStats, StorageAdapter } from '../collector/types.js'

export interface QueryOptions {
  /** Injectable clock for tests. */
  now?: () => number
}

interface Window {
  /** Look back this many minutes. Default 15. */
  sinceMinutes?: number
}

const round = (n: number) => Math.round(n * 10) / 10
const ago = (now: number, ms: number) => Math.max(0, Math.round((now - ms) / 1000))

// Attributes worth showing an agent; everything else is noise for diagnosis.
const KEY_ATTRIBUTES = ['code.filepath', 'code.function', 'http.route', 'http.target', 'http.status_code', 'http.url', 'db.statement']

function exceptionMessage(span: NormalizedSpan): string | null {
  const event = span.events.find((e) => e.name === 'exception')
  const message = event?.attributes['exception.message']
  return typeof message === 'string' ? message : span.statusMessage
}

export interface TraceRow {
  depth: number
  name: string
  service: string
  durationMs: number
  /** Duration minus direct children — where the time was actually spent. */
  selfMs: number
  /** Self time of hidden Next.js internal spans under this one (routing, rendering, dev compilation) — not user code. */
  nextInternalMs?: number
  error?: string
  attributes?: Record<string, unknown>
}

export function createAgentQueries(storage: StorageAdapter, options: QueryOptions = {}) {
  const now = options.now ?? Date.now
  const since = (w: Window) => now() - (w.sinceMinutes ?? 15) * 60_000

  // Runs `query` with the name filter; if nothing matches, runs it without and says so.
  async function withFallback<T>(operation: string | undefined, query: (operation?: string) => Promise<T[]>) {
    const matched = await query(operation)
    if (matched.length > 0 || !operation) return { items: matched, note: undefined }
    return { items: await query(undefined), note: `nothing matches "${operation}", showing all operations instead` }
  }

  // Service names are exact in storage, but models guess them ("checkout" for a route of "porto-shop"). Unknown name →
  // all services plus a note with the real names, like the operation fallback; case-only differences just match.
  async function resolveService(service: string | undefined): Promise<{ service?: string; note?: string }> {
    if (!service) return {}
    const names = (await storage.getServices()).map((s) => s.name)
    const match = names.find((name) => name.toLowerCase() === service.toLowerCase())
    if (match) return { service: match }
    return { note: `no service "${service}" (services: ${names.join(', ') || 'none yet'}), showing all services instead` }
  }

  const joinNotes = (...notes: (string | undefined)[]) => {
    const text = notes.filter(Boolean).join('; ')
    return text ? { note: text } : {}
  }

  return {
    /** Services, their deployed versions and how fresh their data is. */
    async getServices() {
      const services = await storage.getServices()
      return {
        services: services.map((s) => ({ name: s.name, versions: s.versions, spans: s.spanCount, lastSpanSecondsAgo: ago(now(), s.lastSeenMs) })),
      }
    },

    /** Slowest operations by p95 with error rates. */
    async getOperationStats(args: { service?: string; operation?: string; limit?: number } & Window = {}) {
      const { service, note: serviceNote } = await resolveService(args.service)
      const { items, note } = await withFallback(args.operation, (operation) =>
        storage.getOperationStats({ service, hideFramework: true, operation, fromMs: since(args) }),
      )
      return {
        ...joinNotes(serviceNote, note),
        operations: items.slice(0, args.limit ?? 15).map((s) => ({
          service: s.service,
          operation: s.operation,
          count: s.count,
          errorRate: s.errorRate,
          p50Ms: round(s.p50Ms),
          p95Ms: round(s.p95Ms),
          p99Ms: round(s.p99Ms),
        })),
      }
    },

    /**
     * Latest deployed version vs the one before it, per operation (versions ordered by first appearance = deploy order).
     * Biggest p95 increase first — the answer to "which deployment introduced the regression".
     */
    async compareVersions(args: { service?: string; operation?: string } & Window = {}) {
      const deployOrder = new Map((await storage.getServices()).map((s) => [s.name, s.versions]))
      const order = (s: OperationStats) => deployOrder.get(s.service)?.indexOf(s.serviceVersion ?? '') ?? -1

      const { service, note: serviceNote } = await resolveService(args.service)
      const { items, note } = await withFallback(args.operation, (operation) =>
        storage.getOperationStats({ service, hideFramework: true, operation, fromMs: since(args), byVersion: true }),
      )
      const byOperation = new Map<string, OperationStats[]>()
      for (const s of items) {
        const key = `${s.service}\u0000${s.operation}`
        byOperation.set(key, [...(byOperation.get(key) ?? []), s])
      }
      const changes = []
      for (const versions of byOperation.values()) {
        if (versions.length < 2) continue
        const [previous, latest] = [...versions].sort((a, b) => order(a) - order(b)).slice(-2)
        changes.push({
          service: latest.service,
          operation: latest.operation,
          from: { version: previous.serviceVersion ?? 'unknown', count: previous.count, p50Ms: round(previous.p50Ms), p95Ms: round(previous.p95Ms), errorRate: previous.errorRate },
          to: { version: latest.serviceVersion ?? 'unknown', count: latest.count, p50Ms: round(latest.p50Ms), p95Ms: round(latest.p95Ms), errorRate: latest.errorRate },
          p95Ratio: previous.p95Ms > 0 ? round(latest.p95Ms / previous.p95Ms) : null,
          errorRateDelta: round(latest.errorRate - previous.errorRate),
        })
      }
      changes.sort((a, b) => (b.p95Ratio ?? 0) - (a.p95Ratio ?? 0) || b.errorRateDelta - a.errorRateDelta)
      const empty = changes.length === 0 ? 'only one version seen per operation — nothing to compare' : undefined
      return { ...joinNotes(serviceNote, note, empty), changes }
    },

    /** Failing operations: error rate, most common exception messages and example traces. */
    async getErrors(args: { service?: string; operation?: string; limit?: number } & Window = {}) {
      const fromMs = since(args)
      const { service, note: serviceNote } = await resolveService(args.service)
      const stats = await storage.getOperationStats({ service, hideFramework: true, fromMs })
      const errorSpansFor = (operation?: string) => storage.querySpans({ service, hideFramework: true, operation, status: 'error', fromMs, limit: 1000 })
      let errorSpans = await errorSpansFor(args.operation)
      let note: string | undefined
      // Nothing failing under this name → show what IS failing elsewhere. The note keeps "exists but healthy" apart from
      // "no such operation": a user asking about "product pages" needs to see inventory.check failing on those pages.
      if (errorSpans.length === 0 && args.operation) {
        const exists = (await storage.getOperationStats({ service, hideFramework: true, operation: args.operation, fromMs })).length > 0
        note = exists
          ? `"${args.operation}" has no errors in this window; showing failing operations elsewhere`
          : `nothing matches "${args.operation}", showing all operations instead`
        errorSpans = await errorSpansFor(undefined)
      }
      const groups = new Map<string, NormalizedSpan[]>()
      for (const s of errorSpans) {
        const key = `${s.service}\u0000${s.name}`
        groups.set(key, [...(groups.get(key) ?? []), s])
      }
      const errors = [...groups.values()]
        .map((spans) => {
          const { service, name } = spans[0]
          const total = stats.find((s) => s.service === service && s.operation === name)
          const messages = new Map<string, number>()
          for (const s of spans) {
            const message = exceptionMessage(s) ?? '(no message)'
            messages.set(message, (messages.get(message) ?? 0) + 1)
          }
          return {
            service,
            operation: name,
            errors: spans.length,
            errorRate: total?.errorRate ?? null,
            topMessages: [...messages].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message, count]) => ({ message, count })),
            exampleTraceIds: [...new Set(spans.map((s) => s.traceId))].slice(0, 3),
          }
        })
        .sort((a, b) => b.errors - a.errors)
        .slice(0, args.limit ?? 10)
      const empty = errors.length === 0 ? 'no errors in this window' : undefined
      return { ...joinNotes(serviceNote, note, empty), errors }
    },

    /** Recent traces matching filters — to get example trace ids. */
    async searchTraces(args: { service?: string; operation?: string; minDurationMs?: number; hasError?: boolean; limit?: number } & Window = {}) {
      const { service, note: serviceNote } = await resolveService(args.service)
      const { items, note } = await withFallback(args.operation, (operation) =>
        storage.queryTraces({ ...args, service, operation, fromMs: since(args), limit: args.limit ?? 10 }),
      )
      return {
        ...joinNotes(serviceNote, note),
        traces: items.map((t) => ({
          traceId: t.traceId,
          root: t.rootName,
          services: t.services,
          durationMs: round(t.durationMs),
          spans: t.spanCount,
          errors: t.errorCount,
          secondsAgo: ago(now(), t.startTimeMs),
        })),
      }
    },

    /**
     * One trace as a compact tree: depth, duration, self time (duration minus children), errors and code location.
     * `repeated` flags ≥3 same-named siblings — the N+1 signature.
     */
    async getTrace(args: { traceId: string; maxSpans?: number }) {
      const spans = await storage.getTrace(args.traceId)
      if (spans.length === 0) return { note: `trace ${args.traceId} not found`, spans: [], repeated: [] }

      // Next's internal steps are left out and their children attached to the nearest visible ancestor: the agent sees
      // request → user code, and N+1 parents / first error spans are real code, not "executing api route (app) …".
      // A trace made only of framework spans is shown as is.
      const hidden = spans.every(isFrameworkSpan) ? new Set<string>() : new Set(spans.filter(isFrameworkSpan).map((s) => s.spanId))
      const byId = new Map(spans.map((s) => [s.spanId, s]))
      const visibleParent = (s: NormalizedSpan): string | null => {
        let parentId = s.parentSpanId
        for (let hops = 0; parentId && hidden.has(parentId) && hops < spans.length; hops++) parentId = byId.get(parentId)?.parentSpanId ?? null
        return parentId && byId.has(parentId) && !hidden.has(parentId) ? parentId : null
      }
      // Self time is always measured against the real children, so time inside a hidden span stays out of its parent's
      // selfMs and is reported as nextInternalMs of the nearest visible ancestor instead.
      const realChildMs = new Map<string, number>()
      for (const s of spans) if (s.parentSpanId) realChildMs.set(s.parentSpanId, (realChildMs.get(s.parentSpanId) ?? 0) + s.durationMs)
      const selfOf = (s: NormalizedSpan) => Math.max(0, s.durationMs - (realChildMs.get(s.spanId) ?? 0))
      const children = new Map<string | null, NormalizedSpan[]>()
      const nextInternalMs = new Map<string, number>()
      for (const s of spans) {
        const parent = visibleParent(s)
        if (hidden.has(s.spanId)) {
          if (parent) nextInternalMs.set(parent, (nextInternalMs.get(parent) ?? 0) + selfOf(s))
          continue
        }
        children.set(parent, [...(children.get(parent) ?? []), s])
      }

      const rows: TraceRow[] = []
      const repeated: { parent: string; operation: string; count: number; totalMs: number }[] = []
      const visit = (parentId: string | null, parentName: string, depth: number) => {
        const kids = (children.get(parentId) ?? []).sort((a, b) => a.startTimeMs - b.startTimeMs)
        const byName = new Map<string, NormalizedSpan[]>()
        for (const k of kids) byName.set(k.name, [...(byName.get(k.name) ?? []), k])
        for (const [name, same] of byName) {
          if (same.length >= 3) repeated.push({ parent: parentName, operation: name, count: same.length, totalMs: round(same.reduce((a, s) => a + s.durationMs, 0)) })
        }
        for (const s of kids) {
          const internalMs = nextInternalMs.get(s.spanId)
          const attributes = Object.fromEntries(KEY_ATTRIBUTES.filter((k) => s.attributes[k] !== undefined).map((k) => [k, s.attributes[k]]))
          rows.push({
            depth,
            name: s.name,
            service: s.service,
            durationMs: round(s.durationMs),
            selfMs: round(selfOf(s)),
            ...(internalMs ? { nextInternalMs: round(internalMs) } : {}),
            ...(s.status === 'error' ? { error: exceptionMessage(s) ?? 'error' } : {}),
            ...(Object.keys(attributes).length ? { attributes } : {}),
          })
          visit(s.spanId, s.name, depth + 1)
        }
      }
      visit(null, '(root)', 0)

      const max = args.maxSpans ?? 60
      return {
        traceId: args.traceId,
        ...(rows.length > max ? { note: `showing ${max} of ${rows.length} spans` } : {}),
        ...(hidden.size ? { nextInternalSpansHidden: hidden.size } : {}),
        spans: rows.slice(0, max),
        repeated,
      }
    },
  }
}

export type AgentQueries = ReturnType<typeof createAgentQueries>
