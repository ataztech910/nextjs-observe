// Errors grouped into defects: one entry per "this operation fails with this message", however many requests hit it.
// A failing function also marks every span above it as failed, so a defect is counted where the error ORIGINATED —
// the deepest failed span — and the route that returned 500 because of it is listed as affected.
import { isFrameworkSpan } from './framework.js'
import { statusCode } from './overview.js'
import { spanOperation } from './span-label.js'
import type { NormalizedSpan } from './types.js'

export interface DefectsOptions {
  nowMs: number
  windowMs: number
  /** Number of time buckets in each defect's series. */
  buckets: number
  service?: string
  /** Versions per service in deploy order (ServiceInfo.versions). */
  deployOrder: Map<string, string[]>
  /**
   * False when the storage has dropped old spans. Then "not seen before the latest version" may only mean "its older
   * occurrences are gone", and a defect is called new only with evidence: `ranIn` for the previous version.
   */
  historyComplete: boolean
  /** Did this operation run (failed or not) in this version, among the spans still stored? */
  ranIn?: (service: string, operation: string, version: string) => boolean
}

export interface Defect {
  /** Stable for the same service + operation + message shape. */
  id: string
  service: string
  /**
   * Where the error originated, as a person reads it: the span's name — for a browser request the method and the path
   * (`GET /api/inventory/:id`), since the span itself is named just "GET".
   */
  operation: string
  /** The span's exact name: what the operation page and the trace search look up. */
  spanName: string
  /** Where it happened: in the visitor's browser or on the server. */
  source: 'browser' | 'server'
  /**
   * `browser-error`: something the APM agent caught in the page (an uncaught error, a console.error, a failed resource…)
   * — `operation` is then the kind of error, not a piece of code. `request`: an outgoing HTTP call. `code`: the rest.
   */
  category: 'browser-error' | 'request' | 'code'
  /** Pages it happened on (browser errors), most frequent first. */
  pages: { path: string; count: number }[]
  /** The most recent message, as thrown. */
  message: string
  /** exception.type of the most recent occurrence, when recorded. */
  type: string | null
  /** Occurrences in the window. */
  count: number
  /** Occurrences per time bucket of the window. */
  series: number[]
  /** Over everything stored, not just the window. */
  firstSeenMs: number
  lastSeenMs: number
  firstSeenVersion: string | null
  /** In deploy order. */
  versions: string[]
  /**
   * The last deploy brought it: first seen in the service's latest version, which is not the only one — and the older
   * history is trustworthy (nothing dropped, or the operation is still on record running in the previous version).
   */
  isNew: boolean
  /** Requests that failed because of it (the topmost failed span), most frequent first. Empty when it is the origin itself. */
  affected: { service: string; operation: string; spanName: string; count: number }[]
  /** Most recent first. */
  exampleTraceIds: string[]
}

const EXAMPLES = 3
const AFFECTED = 3

function exceptionType(span: NormalizedSpan): string | null {
  const type = span.events.find((e) => e.name === 'exception')?.attributes['exception.type']
  return typeof type === 'string' && type ? type : null
}

export function errorMessage(span: NormalizedSpan): string {
  const event = span.events.find((e) => e.name === 'exception')
  const message = event?.attributes['exception.message']
  if (typeof message === 'string' && message) return message
  if (span.statusMessage) return span.statusMessage
  // A request that failed by its status alone (a 404 seen from the browser, a 500 without an exception) says at
  // least which status.
  const code = statusCode(span)
  return code !== undefined && code >= 400 ? `HTTP ${code}` : '(no message)'
}

/** The APM agent's browser SDK names itself in the resource; its service name ends in "-browser" by convention. */
const isBrowser = (span: NormalizedSpan) => span.resource['telemetry.sdk.language'] === 'webjs' || span.service.endsWith('-browser')

function categoryOf(span: NormalizedSpan): Defect['category'] {
  if (span.attributes['observe.kind'] === 'browser-error') return 'browser-error'
  return span.kind === 'client' && spanOperation(span) !== span.name ? 'request' : 'code'
}

/**
 * The shape of a message: ids and numbers replaced, so "Order 4127 not found" and "Order 9 not found" are one defect.
 * UUIDs first (their short groups would otherwise keep letters: "e29b" → "e<n>b"), then long hex runs (trace ids,
 * hashes), then any remaining digits.
 */
export function messageShape(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>')
}

export function computeDefects(spans: NormalizedSpan[], options: DefectsOptions): Defect[] {
  const { nowMs, windowMs, buckets } = options
  const fromMs = nowMs - windowMs
  const bucketMs = windowMs / buckets
  const failed = spans.filter((s) => s.status === 'error' && (!options.service || s.service === options.service))
  const byId = new Map(failed.map((s) => [`${s.traceId}:${s.spanId}`, s]))
  const parentOf = (s: NormalizedSpan) => (s.parentSpanId ? byId.get(`${s.traceId}:${s.parentSpanId}`) : undefined)
  // Next's own steps ("executing api route (app) …") fail whenever the code inside them does — they are never a defect
  // themselves, unless everything that failed in that trace is framework spans. Decided per trace: one unrelated
  // failure elsewhere must not hide it.
  const tracesWithOwnFailure = new Set(failed.filter((s) => !isFrameworkSpan(s)).map((s) => s.traceId))
  const visible = failed.filter((s) => !isFrameworkSpan(s) || !tracesWithOwnFailure.has(s.traceId))

  // Walk up from every failed span through its failed ancestors: whoever is passed has a failed descendant (so is not
  // an origin), and the last visible one reached is the request that failed because of this span.
  const hasFailedDescendant = new Set<NormalizedSpan>()
  const topOf = new Map<NormalizedSpan, NormalizedSpan>()
  const isVisible = new Set(visible)
  for (const s of visible) {
    let top = s
    for (let p = parentOf(s), hops = 0; p && hops < failed.length; p = parentOf(p), hops++) {
      if (!isVisible.has(p)) continue
      hasFailedDescendant.add(p)
      top = p
    }
    topOf.set(s, top)
  }

  const groups = new Map<string, NormalizedSpan[]>()
  for (const s of visible) {
    if (hasFailedDescendant.has(s)) continue
    const id = `${s.service}\u0000${spanOperation(s)}\u0000${messageShape(errorMessage(s))}`
    const list = groups.get(id)
    if (list) list.push(s)
    else groups.set(id, [s])
  }

  const defects: Defect[] = []
  for (const [id, all] of groups) {
    const recent = all.filter((s) => s.startTimeMs >= fromMs && s.startTimeMs <= nowMs)
    if (recent.length === 0) continue
    all.sort((a, b) => a.startTimeMs - b.startTimeMs)
    const first = all[0]
    const last = all[all.length - 1]
    const order = options.deployOrder.get(first.service) ?? []
    const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length)
    const versions = [...new Set(all.map((s) => s.serviceVersion).filter((v): v is string => !!v))].sort((a, b) => rank(a) - rank(b))
    const series = Array.from({ length: buckets }, () => 0)
    for (const s of recent) series[Math.min(Math.floor((s.startTimeMs - fromMs) / bucketMs), buckets - 1)]++
    // The failed request may belong to another service than the origin (browser → server): keep its own service.
    const affected = new Map<string, { service: string; operation: string; spanName: string; count: number }>()
    for (const s of recent) {
      const top = topOf.get(s)!
      if (top === s) continue
      const operation = spanOperation(top)
      const key = `${top.service}\u0000${operation}`
      const row = affected.get(key) ?? { service: top.service, operation, spanName: top.name, count: 0 }
      row.count++
      affected.set(key, row)
    }
    const pages = new Map<string, number>()
    for (const s of recent) {
      const path = s.attributes['url.path']
      if (typeof path === 'string' && path) pages.set(path, (pages.get(path) ?? 0) + 1)
    }
    const latest = order[order.length - 1]
    const previous = order[order.length - 2]
    const firstInLatest = order.length > 1 && first.serviceVersion === latest
    defects.push({
      id,
      service: first.service,
      operation: spanOperation(first),
      spanName: first.name,
      source: isBrowser(first) ? 'browser' : 'server',
      category: categoryOf(first),
      pages: [...pages].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, AFFECTED),
      message: errorMessage(last),
      type: exceptionType(last),
      count: recent.length,
      series,
      firstSeenMs: first.startTimeMs,
      lastSeenMs: last.startTimeMs,
      firstSeenVersion: first.serviceVersion,
      versions,
      isNew: firstInLatest && (options.historyComplete || (options.ranIn?.(first.service, first.name, previous) ?? false)),
      affected: [...affected.values()].sort((a, b) => b.count - a.count).slice(0, AFFECTED),
      exampleTraceIds: [...new Set([...recent].sort((a, b) => b.startTimeMs - a.startTimeMs).map((s) => s.traceId))].slice(0, EXAMPLES),
    })
  }
  // What the last deploy broke comes first, then by how often.
  return defects.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.count - a.count)
}
