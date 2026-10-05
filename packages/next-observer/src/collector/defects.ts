// Errors grouped into defects: one entry per "this operation fails with this message", however many requests hit it.
// A failing function also marks every span above it as failed, so a defect is counted where the error ORIGINATED —
// the deepest failed span — and the route that returned 500 because of it is listed as affected.
import { isFrameworkSpan } from './framework.js'
import type { NormalizedSpan } from './types.js'

export interface DefectsOptions {
  nowMs: number
  windowMs: number
  /** Number of time buckets in each defect's series. */
  buckets: number
  service?: string
  /** Versions per service in deploy order (ServiceInfo.versions). */
  deployOrder: Map<string, string[]>
}

export interface Defect {
  /** Stable for the same service + operation + message shape. */
  id: string
  service: string
  /** Where the error originated. */
  operation: string
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
  /** First seen in the service's latest version, and that version is not the only one: the last deploy brought it. */
  isNew: boolean
  /** Requests that failed because of it (the topmost failed span), most frequent first. Empty when it is the origin itself. */
  affected: { operation: string; count: number }[]
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
  return (typeof message === 'string' && message) || span.statusMessage || '(no message)'
}

/**
 * The shape of a message: ids and numbers replaced, so "Order 4127 not found" and "Order 9 not found" are one defect.
 * Long hex runs first (trace ids, hashes, UUID parts), then any remaining digits.
 */
export function messageShape(message: string): string {
  return message.replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\d+/g, '<n>')
}

export function computeDefects(spans: NormalizedSpan[], options: DefectsOptions): Defect[] {
  const { nowMs, windowMs, buckets } = options
  const fromMs = nowMs - windowMs
  const bucketMs = windowMs / buckets
  const failed = spans.filter((s) => s.status === 'error' && (!options.service || s.service === options.service))
  const byId = new Map(failed.map((s) => [`${s.traceId}:${s.spanId}`, s]))
  const parentOf = (s: NormalizedSpan) => (s.parentSpanId ? byId.get(`${s.traceId}:${s.parentSpanId}`) : undefined)
  // Next's own steps ("executing api route (app) …") fail whenever the code inside them does — they are never a defect
  // themselves, unless the whole failed chain is framework spans.
  const candidates = failed.filter((s) => !isFrameworkSpan(s))
  const visible = candidates.length > 0 ? candidates : failed

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
    const id = `${s.service}\u0000${s.name}\u0000${messageShape(errorMessage(s))}`
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
    const affected = new Map<string, number>()
    for (const s of recent) {
      const top = topOf.get(s)!
      if (top !== s) affected.set(top.name, (affected.get(top.name) ?? 0) + 1)
    }
    defects.push({
      id,
      service: first.service,
      operation: first.name,
      message: errorMessage(last),
      type: exceptionType(last),
      count: recent.length,
      series,
      firstSeenMs: first.startTimeMs,
      lastSeenMs: last.startTimeMs,
      firstSeenVersion: first.serviceVersion,
      versions,
      isNew: order.length > 1 && first.serviceVersion === order[order.length - 1],
      affected: [...affected].map(([operation, count]) => ({ operation, count })).sort((a, b) => b.count - a.count).slice(0, AFFECTED),
      exampleTraceIds: [...new Set([...recent].sort((a, b) => b.startTimeMs - a.startTimeMs).map((s) => s.traceId))].slice(0, EXAMPLES),
    })
  }
  // What the last deploy broke comes first, then by how often.
  return defects.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.count - a.count)
}
