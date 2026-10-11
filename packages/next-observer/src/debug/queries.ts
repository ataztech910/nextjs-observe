// Agent tools as plain functions over the StorageAdapter — no LLM framework here, so they're testable on their own
// and any agent runtime (ADK today) wraps them in one line.
// Rules for every tool: compact, token-cheap output (aggregates, not raw spans), rounded numbers, and a `note`
// instead of an empty result when a name filter matches nothing (users say "checkout", spans say "chargePayment").
import { isFrameworkSpan } from '../collector/framework.js'
import { INTEGRITY_CHECK_EVENT, integrityFailureEvent } from './detector.js'
import { errorRateChangeIsSignificant } from './stats.js'
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
  /** First request of this route after a server start — in next dev its time includes compiling the route. */
  coldStart?: boolean
  /** Self time of hidden Next.js internal spans under this one (routing, rendering, dev compilation) — not user code. */
  nextInternalMs?: number
  error?: string
  /** A verified wrong-data response (incident F) — distinct from `error`: status was fine, duration was fine, the
   * data inside was not what was asked for. Only an app that instruments its own identity check can ever report this. */
  integrityCheck?: { expected: unknown; actual: unknown }
  attributes?: Record<string, unknown>
}

/** Rows of the per-version integrity table an agent gets; more would not be read. */
const MAX_INTEGRITY_ROWS = 10

export function createAgentQueries(storage: StorageAdapter, options: QueryOptions = {}) {
  const now = options.now ?? Date.now
  // The tool schema cannot say "positive" (see investigator.ts), so a model may send 0 or -5: treat it as not given.
  const since = (w: Window) => now() - (w.sinceMinutes !== undefined && w.sinceMinutes > 0 ? w.sinceMinutes : 15) * 60_000

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

  // Cold starts are left out of latency aggregates; the agent is told how many, so it can mention it.
  const coldNote = (items: OperationStats[]) => {
    const left = items.filter((s) => !s.onlyColdStarts).reduce((n, s) => n + (s.coldStarts ?? 0), 0)
    return left > 0 ? `${left} cold-start request(s) left out — the first request of a route after a server start (in next dev it includes compiling the route)` : undefined
  }

  /**
   * The app's own "did I get what I asked for" checks (span event `integrity_check`), counted per version over everything
   * stored — not the time window: the version before the deployment is exactly the one that stopped sending. Latency
   * and error rate cannot answer "which deployment started returning wrong data"; these counts can.
   *
   * Of the whole service, whatever operation was asked about: the check usually sits on a span deep inside the
   * request (a database call), which nobody names in a question about "checkout".
   */
  async function integrityByVersion(service: string | undefined, deployOrder: Map<string, string[]>) {
    const counts = new Map<string, { service: string; operation: string; versions: Map<string, { checked: number; failed: number }> }>()
    for (const span of await storage.querySpans({ service, limit: Number.MAX_SAFE_INTEGER })) {
      // A span without a version cannot be placed in the deploy order — counting it would only blur which one did it.
      if (!span.serviceVersion) continue
      const checks = span.events.filter((e) => e.name === INTEGRITY_CHECK_EVENT)
      if (checks.length === 0) continue
      const key = `${span.service}\u0000${span.name}`
      const entry = counts.get(key) ?? { service: span.service, operation: span.name, versions: new Map() }
      const count = entry.versions.get(span.serviceVersion) ?? { checked: 0, failed: 0 }
      count.checked += checks.length
      count.failed += checks.filter((e) => e.attributes.ok === false).length
      entry.versions.set(span.serviceVersion, count)
      counts.set(key, entry)
    }
    const failedNow = (versions: { failed: number }[]) => versions.at(-1)?.failed ?? 0
    const failedEver = (versions: { failed: number }[]) => versions.reduce((n, v) => n + v.failed, 0)
    const all = [...counts.values()]
      .map((entry) => {
        const order = deployOrder.get(entry.service) ?? []
        const versions = [...entry.versions].map(([version, count]) => ({ version, ...count })).sort((a, b) => order.indexOf(a.version) - order.indexOf(b.version))
        return { service: entry.service, operation: entry.operation, versions }
      })
      // What is wrong in the latest version first, then what was wrong before; "checked, never wrong" last.
      .sort((a, b) => failedNow(b.versions) - failedNow(a.versions) || failedEver(b.versions) - failedEver(a.versions))
    const notes = [
      all.length > MAX_INTEGRITY_ROWS ? `integrity: showing ${MAX_INTEGRITY_ROWS} of ${all.length} checked operations` : undefined,
      // Counts of an earlier version shrink as its spans are dropped: "0 failed" there is then weaker evidence.
      all.length > 0 && !storage.isHistoryComplete() ? 'integrity: old spans were dropped to make room — the counts for earlier versions are incomplete' : undefined,
    ]
    return { integrity: all.slice(0, MAX_INTEGRITY_ROWS), notes }
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
        services: services.map((s) => ({
          name: s.name,
          versions: s.versions,
          // `versions` is every version ever seen: without this a model reads "v2, v3" as "both are running".
          versionLastSpanSecondsAgo: Object.fromEntries(s.versions.flatMap((v) => (s.versionLastSeenMs[v] === undefined ? [] : [[v, ago(now(), s.versionLastSeenMs[v])]]))),
          spans: s.spanCount,
          lastSpanSecondsAgo: ago(now(), s.lastSeenMs),
        })),
      }
    },

    /** Slowest operations by p95 with error rates. */
    async getOperationStats(args: { service?: string; operation?: string; limit?: number } & Window = {}) {
      const { service, note: serviceNote } = await resolveService(args.service)
      const { items, note } = await withFallback(args.operation, (operation) =>
        storage.getOperationStats({ service, hideFramework: true, hideColdStarts: true, operation, fromMs: since(args) }),
      )
      return {
        ...joinNotes(serviceNote, note, coldNote(items)),
        operations: items.slice(0, args.limit ?? 15).map((s) => ({
          service: s.service,
          operation: s.operation,
          count: s.count,
          errorRate: s.errorRate,
          p50Ms: round(s.p50Ms),
          p95Ms: round(s.p95Ms),
          p99Ms: round(s.p99Ms),
          ...(s.onlyColdStarts ? { onlyColdStarts: true } : {}),
        })),
      }
    },

    /**
     * Latest deployed version vs the one before it, per operation (versions ordered by first appearance = deploy order).
     * Biggest p95 increase first — the answer to "which deployment introduced the regression".
     */
    async compareVersions(args: { service?: string; operation?: string; /** false skips the scan for the app's own checks — for callers that only want `changes`. */ integrity?: boolean } & Window = {}) {
      const services = await storage.getServices()
      const deployOrder = new Map(services.map((s) => [s.name, s.versions]))
      const order = (s: OperationStats) => deployOrder.get(s.service)?.indexOf(s.serviceVersion ?? '') ?? -1

      const { service, note: serviceNote } = await resolveService(args.service)
      const { items, note } = await withFallback(args.operation, (operation) =>
        storage.getOperationStats({ service, hideFramework: true, hideColdStarts: true, operation, fromMs: since(args), byVersion: true }),
      )
      const byOperation = new Map<string, OperationStats[]>()
      for (const s of items) {
        const key = `${s.service}\u0000${s.operation}`
        byOperation.set(key, [...(byOperation.get(key) ?? []), s])
      }
      // After a deploy the previous version stops sending, and once its traffic is older than the window there is nothing
      // to compare with — exactly when "which deployment did this?" matters. Then use the previous version's own last
      // window of traffic, and say so.
      const windowMs = now() - since(args)
      const olderNotes: string[] = []
      const fetched = new Map<string, OperationStats[]>()
      for (const versions of byOperation.values()) {
        if (versions.length !== 1) continue
        const [latest] = versions
        const all = deployOrder.get(latest.service) ?? []
        const previous = all[all.indexOf(latest.serviceVersion ?? '') - 1]
        const lastSeen = previous !== undefined ? services.find((s) => s.name === latest.service)?.versionLastSeenMs[previous] : undefined
        if (previous === undefined || lastSeen === undefined) continue
        const key = `${latest.service}\u0000${previous}`
        if (!fetched.has(key)) {
          const stats = await storage.getOperationStats({ service: latest.service, hideFramework: true, hideColdStarts: true, fromMs: lastSeen - windowMs, toMs: lastSeen, byVersion: true })
          fetched.set(key, stats.filter((s) => s.serviceVersion === previous))
          olderNotes.push(`${previous} has no traffic in this window — compared with its last ${Math.round(windowMs / 60_000)} min of traffic (until ${Math.round((now() - lastSeen) / 60_000)} min ago)`)
        }
        const match = fetched.get(key)!.find((s) => s.operation === latest.operation)
        if (match) versions.push(match)
      }

      const changes = []
      for (const versions of byOperation.values()) {
        if (versions.length < 2) continue
        const [previous, latest] = [...versions].sort((a, b) => order(a) - order(b)).slice(-2)
        changes.push({
          service: latest.service,
          operation: latest.operation,
          from: { version: previous.serviceVersion ?? 'unknown', count: previous.count, p50Ms: round(previous.p50Ms), p95Ms: round(previous.p95Ms), errorRate: previous.errorRate, ...(previous.onlyColdStarts ? { onlyColdStarts: true } : {}) },
          to: { version: latest.serviceVersion ?? 'unknown', count: latest.count, p50Ms: round(latest.p50Ms), p95Ms: round(latest.p95Ms), errorRate: latest.errorRate, ...(latest.onlyColdStarts ? { onlyColdStarts: true } : {}) },
          p95Ratio: previous.p95Ms > 0 ? round(latest.p95Ms / previous.p95Ms) : null,
          errorRateDelta: round(latest.errorRate - previous.errorRate),
          // A z-test, not the raw delta: with few requests a random 30% failure rate jumps around between versions.
          errorRateChangeSignificant: errorRateChangeIsSignificant(previous, latest),
        })
      }
      changes.sort((a, b) => (b.p95Ratio ?? 0) - (a.p95Ratio ?? 0) || b.errorRateDelta - a.errorRateDelta)
      const { integrity, notes: integrityNotes } = args.integrity === false ? { integrity: [], notes: [] } : await integrityByVersion(service, deployOrder)
      // Said precisely — "nothing to compare" would talk the model out of reading the integrity table next to it.
      const empty = changes.length === 0 ? 'only one version seen per operation — no latency or error-rate comparison' : undefined
      return { ...joinNotes(serviceNote, note, coldNote(items), ...olderNotes, empty, ...integrityNotes), changes, ...(integrity.length > 0 ? { integrity } : {}) }
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
      // "Is this new?" needs history beyond the window: when each message first appeared, and in which versions.
      // Over everything stored (memory keeps the most recent spans), not just sinceMinutes.
      const deployOrder = new Map((await storage.getServices()).map((s) => [s.name, s.versions]))
      const history = async (service: string, operation: string, message: string) => {
        const all = (await storage.querySpans({ service, operation, status: 'error', limit: 100_000 })).filter(
          (s) => s.name === operation && (exceptionMessage(s) ?? '(no message)') === message,
        )
        const first = all.reduce((a, b) => (b.startTimeMs < a.startTimeMs ? b : a))
        const order = deployOrder.get(service) ?? []
        const versions = [...new Set(all.map((s) => s.serviceVersion).filter((v): v is string => !!v))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
        return {
          firstSeenMinutesAgo: Math.round((now() - first.startTimeMs) / 6_000) / 10,
          ...(first.serviceVersion ? { firstSeenVersion: first.serviceVersion } : {}),
          ...(versions.length ? { seenInVersions: versions } : {}),
        }
      }

      const groups = new Map<string, NormalizedSpan[]>()
      for (const s of errorSpans) {
        const key = `${s.service}\u0000${s.name}`
        groups.set(key, [...(groups.get(key) ?? []), s])
      }
      const errors = (await Promise.all([...groups.values()]
        .map(async (spans) => {
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
            topMessages: await Promise.all(
              [...messages].sort((a, b) => b[1] - a[1]).slice(0, 3).map(async ([message, count]) => ({ message, count, ...(await history(service, name, message)) })),
            ),
            exampleTraceIds: [...new Set(spans.map((s) => s.traceId))].slice(0, 3),
          }
        })))
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
      // Children are merged as intervals and clipped to the parent (the same rule as the UI's trace page): two parallel
      // calls are not subtracted twice, and a fire-and-forget child that ends after its parent does not zero it out.
      const realChildren = new Map<string, NormalizedSpan[]>()
      for (const s of spans) {
        if (!s.parentSpanId) continue
        const list = realChildren.get(s.parentSpanId)
        if (list) list.push(s)
        else realChildren.set(s.parentSpanId, [s])
      }
      const selfOf = (s: NormalizedSpan) => {
        const end = s.startTimeMs + s.durationMs
        const intervals = (realChildren.get(s.spanId) ?? [])
          .map((c) => [Math.max(c.startTimeMs, s.startTimeMs), Math.min(c.startTimeMs + c.durationMs, end)] as const)
          .filter(([from, to]) => to > from)
          .sort((a, b) => a[0] - b[0])
        let covered = 0
        let cursor = -Infinity
        for (const [from, to] of intervals) {
          if (to <= cursor) continue
          covered += to - Math.max(from, cursor)
          cursor = to
        }
        return Math.max(0, s.durationMs - covered)
      }
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
          const integrityEvent = integrityFailureEvent(s)
          rows.push({
            depth,
            name: s.name,
            service: s.service,
            durationMs: round(s.durationMs),
            selfMs: round(selfOf(s)),
            ...(storage.isColdStart(s) ? { coldStart: true } : {}),
            ...(internalMs ? { nextInternalMs: round(internalMs) } : {}),
            ...(s.status === 'error' ? { error: exceptionMessage(s) ?? 'error' } : {}),
            // Checked independent of `status`: incident F's whole point is that this fires on spans that are
            // otherwise fine — fast, no error — so it is never conditioned on one already being set above.
            ...(integrityEvent ? { integrityCheck: { expected: integrityEvent.attributes.expected, actual: integrityEvent.attributes.actual } } : {}),
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
