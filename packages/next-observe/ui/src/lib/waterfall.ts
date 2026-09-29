// Pure waterfall layout: spans (already in waterfall order from the API) → rows with depth and bar geometry.
export interface WaterfallSpan {
  spanId: string
  parentSpanId: string | null
  name: string
  service: string
  startTimeMs: number
  durationMs: number
  status: 'unset' | 'ok' | 'error'
}

export interface WaterfallRow<S extends WaterfallSpan = WaterfallSpan> {
  span: S
  depth: number
  /** Bar start, % of the trace duration. */
  offsetPct: number
  /** Bar width, % of the trace duration (never 0 so tiny spans stay visible). */
  widthPct: number
}

export interface WaterfallLayout<S extends WaterfallSpan = WaterfallSpan> {
  rows: WaterfallRow<S>[]
  startTimeMs: number
  durationMs: number
}

const MIN_WIDTH_PCT = 0.2

// Rows follow a depth-first walk (parent, then its children by start time) so nesting reads top-down.
// Spans whose parent is missing (not arrived yet) become roots.
export function layoutWaterfall<S extends WaterfallSpan>(spans: S[]): WaterfallLayout<S> {
  if (spans.length === 0) return { rows: [], startTimeMs: 0, durationMs: 0 }
  const start = Math.min(...spans.map((s) => s.startTimeMs))
  const end = Math.max(...spans.map((s) => s.startTimeMs + s.durationMs))
  const total = Math.max(end - start, 1e-6)

  const ids = new Set(spans.map((s) => s.spanId))
  const children = new Map<string | null, S[]>()
  for (const s of spans) {
    const parent = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null
    const list = children.get(parent)
    if (list) list.push(s)
    else children.set(parent, [s])
  }
  for (const list of children.values()) list.sort((a, b) => a.startTimeMs - b.startTimeMs)

  const rows: WaterfallRow<S>[] = []
  const visit = (parent: string | null, depth: number) => {
    for (const span of children.get(parent) ?? []) {
      const offsetPct = ((span.startTimeMs - start) / total) * 100
      rows.push({ span, depth, offsetPct, widthPct: Math.max((span.durationMs / total) * 100, MIN_WIDTH_PCT) })
      visit(span.spanId, depth + 1)
    }
  }
  visit(null, 0)
  return { rows, startTimeMs: start, durationMs: end - start }
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
