import type { NormalizedSpan } from './types.js'
import type { RunTraceSummary } from './run-types.js'

/** Full retained archive projection, not a truncated trace-list API response. */
export function summarizeRunTraces(spans: NormalizedSpan[]): RunTraceSummary[] {
  const groups = new Map<string, NormalizedSpan[]>()
  for (const span of spans) {
    const group = groups.get(span.traceId)
    if (group) group.push(span)
    else groups.set(span.traceId, [span])
  }
  const result: RunTraceSummary[] = []
  for (const [traceId, group] of groups) {
    const ids = new Set(group.map((s) => s.spanId))
    let first = group[0], root: NormalizedSpan | undefined
    let start = Infinity, end = -Infinity, errorCount = 0, missingParentCount = 0
    const services = new Set<string>()
    for (const span of group) {
      if (span.startTimeMs < first.startTimeMs) first = span
      if ((!span.parentSpanId || !ids.has(span.parentSpanId)) && (!root || span.startTimeMs < root.startTimeMs)) root = span
      if (span.parentSpanId && !ids.has(span.parentSpanId)) missingParentCount++
      start = Math.min(start, span.startTimeMs); end = Math.max(end, span.startTimeMs + span.durationMs)
      if (span.status === 'error') errorCount++
      services.add(span.service)
    }
    result.push({ traceId, name: (root ?? first).name, spanCount: group.length, errorCount, missingParentCount, startTimeMs: start, durationMs: end - start, services: [...services].sort() })
  }
  return result.sort((a, b) => a.startTimeMs - b.startTimeMs || a.traceId.localeCompare(b.traceId))
}
