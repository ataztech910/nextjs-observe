// Where a trace's time went. Pure functions over the spans of one trace.
import type { WaterfallSpan } from './waterfall.js'

const end = (s: WaterfallSpan) => s.startTimeMs + s.durationMs

// Keyed by parent id. A span whose parent has not arrived sits under an id nobody looks up — it is simply a root.
function childrenOf<S extends WaterfallSpan>(spans: S[]): Map<string, S[]> {
  const children = new Map<string, S[]>()
  for (const s of spans) {
    if (!s.parentSpanId) continue
    const list = children.get(s.parentSpanId)
    if (list) list.push(s)
    else children.set(s.parentSpanId, [s])
  }
  return children
}

/**
 * Self time per span: its duration minus the time covered by its direct children. Children are merged as intervals
 * and clipped to the parent, so two calls running in parallel are not subtracted twice (their sum can exceed the
 * parent) and a child that outlives its parent does not make the parent negative — self is never below 0.
 */
export function selfTimes(spans: WaterfallSpan[]): Map<string, number> {
  const children = childrenOf(spans)
  const self = new Map<string, number>()
  for (const s of spans) {
    const intervals = (children.get(s.spanId) ?? [])
      .map((c) => [Math.max(c.startTimeMs, s.startTimeMs), Math.min(end(c), end(s))] as const)
      .filter(([from, to]) => to > from)
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let cursor = -Infinity
    for (const [from, to] of intervals) {
      if (to <= cursor) continue
      covered += to - Math.max(from, cursor)
      cursor = to
    }
    // Clamped: start + duration − start is not exactly duration in floating point, and −4e-17 would print as "-0µs".
    self.set(s.spanId, Math.max(0, s.durationMs - covered))
  }
  return self
}

/**
 * The spans that decided how long the trace took: from the end of a span walk backwards, each time taking the child
 * that finished last before the current point. Making any other span faster would not make the trace faster.
 */
export function criticalPath(spans: WaterfallSpan[]): Set<string> {
  const path = new Set<string>()
  if (spans.length === 0) return path
  const ids = new Set(spans.map((s) => s.spanId))
  const children = childrenOf(spans)
  const roots = spans.filter((s) => !s.parentSpanId || !ids.has(s.parentSpanId))
  // Several roots (the parent has not arrived yet): the one that ends last decides the duration.
  const root = roots.reduce((a, b) => (end(b) > end(a) ? b : a))

  const visit = (span: WaterfallSpan) => {
    path.add(span.spanId)
    let cursor = end(span)
    const kids = [...(children.get(span.spanId) ?? [])].sort((a, b) => end(b) - end(a))
    for (const kid of kids) {
      // A child still running after the point we wait for did not hold that point back.
      if (end(kid) > cursor) continue
      visit(kid)
      cursor = kid.startTimeMs
    }
  }
  visit(root)
  return path
}

export interface OperationTime {
  name: string
  service: string
  calls: number
  selfMs: number
  totalMs: number
  /** Share of the trace's duration spent in this operation's own code, 0…1. */
  selfShare: number
}

/** Self and total time per operation (same name and service), biggest self time first. */
export function timeByOperation(spans: WaterfallSpan[], traceDurationMs: number): OperationTime[] {
  const self = selfTimes(spans)
  const groups = new Map<string, OperationTime>()
  for (const s of spans) {
    const key = `${s.service}\u0000${s.name}`
    const row = groups.get(key) ?? { name: s.name, service: s.service, calls: 0, selfMs: 0, totalMs: 0, selfShare: 0 }
    row.calls++
    row.selfMs += self.get(s.spanId) ?? 0
    row.totalMs += s.durationMs
    groups.set(key, row)
  }
  const rows = [...groups.values()]
  for (const r of rows) r.selfShare = traceDurationMs > 0 ? r.selfMs / traceDurationMs : 0
  return rows.sort((a, b) => b.selfMs - a.selfMs)
}

export type Standing = 'fast' | 'typical' | 'slow'

/** Where one call stands among the others of its operation: slower than 95% of them, faster than half, or in between. */
export function standing(durationMs: number, others: { p50Ms: number; p95Ms: number }): Standing {
  if (durationMs > others.p95Ms) return 'slow'
  return durationMs < others.p50Ms ? 'fast' : 'typical'
}
