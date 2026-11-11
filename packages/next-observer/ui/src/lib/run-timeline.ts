import type { NormalizedSpan, SpanEvent } from '../../../src/collector/types.js'
import { formatDuration } from './waterfall.js'

export interface RunTimelineEvent { event: SpanEvent; offsetPct: number; offsetMs: number; exactUnixNano: string | null }
export interface RunTimelineRow { key: string; span: NormalizedSpan; depth: number; offsetPct: number; widthPct: number; durationMs: number; events: RunTimelineEvent[] }
export interface RunTimeline {
  rows: RunTimelineRow[]; durationMs: number; precision: 'exact-nanoseconds' | 'millisecond-projection'
  duplicateCount: number; missingParents: number; cycleCount: number; eventsOutsideSpan: number
}
const key = (s: NormalizedSpan) => `${s.traceId}:${s.spanId}`
function nanos(value: string | number | undefined): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null
  return BigInt(value)
}
/** Relative subtraction happens before Number conversion; legacy timestamps never gain fictitious ns precision. */
export function layoutRunTimeline(input: NormalizedSpan[]): RunTimeline {
  const unique = new Map<string, NormalizedSpan>()
  let duplicateCount = 0
  for (const span of input) { if (unique.has(key(span))) duplicateCount++; else unique.set(key(span), span) }
  const spans = [...unique.values()]
  const exact = spans.length > 0 && spans.every((s) => { const a = nanos(s.startTimeUnixNano), b = nanos(s.endTimeUnixNano); return a !== null && b !== null && b >= a })
  const precision = exact ? 'exact-nanoseconds' : 'millisecond-projection'
  let anchor = 0n
  if (exact) { anchor = nanos(spans[0].startTimeUnixNano)!; for (const s of spans) if (nanos(s.startTimeUnixNano)! < anchor) anchor = nanos(s.startTimeUnixNano)! }
  let anchorMs = spans[0]?.startTimeMs ?? 0
  for (const s of spans) anchorMs = Math.min(anchorMs, s.startTimeMs)
  const start = (s: NormalizedSpan) => exact ? Number(nanos(s.startTimeUnixNano)! - anchor) / 1e6 : s.startTimeMs - anchorMs
  const duration = (s: NormalizedSpan) => exact ? Number(nanos(s.endTimeUnixNano)! - nanos(s.startTimeUnixNano)!) / 1e6 : s.durationMs
  const events = (s: NormalizedSpan) => s.events.map((event, i) => {
    const source = s.otlp?.span.events?.[i]
    const ns = source?.name === event.name ? nanos(String(source.timeUnixNano)) : null
    return { event, offsetMs: exact && ns !== null ? Number(ns - anchor) / 1e6 : event.timeMs - (exact ? Number(anchor / 1000n) / 1000 : anchorMs), exactUnixNano: ns === null ? null : ns.toString() }
  })
  const observations = new Map(spans.map((s) => [key(s), { start: start(s), duration: duration(s), events: events(s) }]))
  let from = 0, to = 0, eventsOutsideSpan = 0
  for (const o of observations.values()) {
    from = Math.min(from, o.start); to = Math.max(to, o.start + o.duration)
    for (const e of o.events) { from = Math.min(from, e.offsetMs); to = Math.max(to, e.offsetMs); if (e.offsetMs < o.start || e.offsetMs > o.start + o.duration) eventsOutsideSpan++ }
  }
  const total = to - from
  const pct = (ms: number) => total === 0 ? 0 : (ms - from) / total * 100
  const children = new Map<string, NormalizedSpan[]>()
  const roots: NormalizedSpan[] = []
  let missingParents = 0
  for (const s of spans) {
    const parent = s.parentSpanId ? `${s.traceId}:${s.parentSpanId}` : null
    if (parent && unique.has(parent)) { const list = children.get(parent) ?? []; list.push(s); children.set(parent, list) }
    else { roots.push(s); if (parent) missingParents++ }
  }
  const compare = (a: NormalizedSpan, b: NormalizedSpan) => observations.get(key(a))!.start - observations.get(key(b))!.start || key(a).localeCompare(key(b))
  roots.sort(compare); for (const list of children.values()) list.sort(compare)
  const rows: RunTimelineRow[] = [], visited = new Set<string>()
  let cycleCount = 0
  const visit = (root: NormalizedSpan) => {
    const stack = [{ span: root, depth: 0 }]
    while (stack.length) {
      const { span, depth } = stack.pop()!, identity = key(span)
      if (visited.has(identity)) { cycleCount++; continue }
      visited.add(identity)
      const o = observations.get(identity)!
      rows.push({ key: identity, span, depth, offsetPct: pct(o.start), widthPct: total === 0 ? 0 : o.duration / total * 100, durationMs: o.duration, events: o.events.map((e) => ({ ...e, offsetPct: pct(e.offsetMs) })) })
      const kids = children.get(identity) ?? []
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ span: kids[i], depth: depth + 1 })
    }
  }
  for (const root of roots) visit(root)
  // Cyclic components have no roots. Keep them visible, terminate traversal, never infer a critical path.
  for (const span of spans.sort(compare)) if (!visited.has(key(span))) visit(span)
  return { rows, durationMs: total, precision, duplicateCount, missingParents, cycleCount, eventsOutsideSpan }
}
export function timelineDuration(span: NormalizedSpan): string {
  const a = nanos(span.startTimeUnixNano), b = nanos(span.endTimeUnixNano)
  if (a !== null && b !== null && b >= a && b - a < 1000n) return `${b - a} ns`
  return formatDuration(span.durationMs)
}
