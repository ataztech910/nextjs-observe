// Tool result → evidence cards. Pure and deterministic: thresholds decide what is worth showing.
import type { EvidenceCard } from '../collector/chat.js'
import type { AgentQueries } from '../debug/queries.js'

export const THRESHOLDS = {
  /** p95 latest / previous version. */
  regressionRatio: 1.5,
  /** errorRate latest − previous version. */
  regressionErrorDelta: 0.1,
  errorRate: 0.05,
  /** One span's self time as a share of the whole trace. */
  hotspotShare: 0.5,
  silentSeconds: 120,
}

type Result<K extends keyof AgentQueries> = Awaited<ReturnType<AgentQueries[K]>>

function describeFilters(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
  return parts.length ? `Traces · ${parts.join(', ')}` : 'Recent traces'
}

export function cardsFromResult(tool: string, args: Record<string, unknown>, result: unknown): EvidenceCard[] {
  switch (tool) {
    case 'compare_versions': {
      const { changes } = result as Result<'compareVersions'>
      return changes
        .filter((c) => (c.p95Ratio ?? 0) >= THRESHOLDS.regressionRatio || c.errorRateDelta >= THRESHOLDS.regressionErrorDelta)
        .map((c) => ({ kind: 'regression', service: c.service, operation: c.operation, from: c.from, to: c.to, p95Ratio: c.p95Ratio, errorRateDelta: c.errorRateDelta }))
    }
    case 'get_errors': {
      const { errors } = result as Result<'getErrors'>
      return errors
        .filter((e) => (e.errorRate ?? 1) >= THRESHOLDS.errorRate)
        .map((e) => ({
          kind: 'errors',
          service: e.service,
          operation: e.operation,
          errorRate: e.errorRate,
          errors: e.errors,
          message: e.topMessages[0]?.message ?? '(no message)',
          traceIds: e.exampleTraceIds,
        }))
    }
    case 'get_trace': {
      const trace = result as Result<'getTrace'>
      if (!('traceId' in trace) || trace.spans.length === 0) return []
      const cards: EvidenceCard[] = trace.repeated.map((r) => ({ kind: 'n-plus-one', traceId: trace.traceId, parent: r.parent, operation: r.operation, count: r.count, totalMs: r.totalMs }))
      const traceMs = trace.spans[0].durationMs
      const hottest = trace.spans
        .filter((s) => s.depth > 0 && typeof s.attributes?.['code.filepath'] === 'string')
        .sort((a, b) => b.selfMs - a.selfMs)[0]
      if (hottest && traceMs > 0 && hottest.selfMs / traceMs >= THRESHOLDS.hotspotShare) {
        cards.push({ kind: 'hotspot', traceId: trace.traceId, operation: hottest.name, selfMs: hottest.selfMs, traceMs, codeFile: String(hottest.attributes!['code.filepath']) })
      }
      return cards
    }
    case 'get_services': {
      const { services } = result as Result<'getServices'>
      return services
        .filter((s) => s.lastSpanSecondsAgo > THRESHOLDS.silentSeconds)
        .map((s) => ({ kind: 'silent', service: s.name, lastSpanSecondsAgo: s.lastSpanSecondsAgo }))
    }
    case 'search_traces': {
      const { traces } = result as Result<'searchTraces'>
      if (traces.length === 0) return []
      return [{ kind: 'traces', label: describeFilters(args), traces: traces.slice(0, 5).map((t) => ({ traceId: t.traceId, root: t.root, durationMs: t.durationMs, errors: t.errors })) }]
    }
    default:
      return []
  }
}

/** Same finding reported twice in one turn (e.g. two agents compared versions) shows once. */
export function cardKey(card: EvidenceCard): string {
  switch (card.kind) {
    case 'regression':
    case 'errors':
      return `${card.kind}:${card.service}:${card.operation}`
    case 'n-plus-one':
      return `${card.kind}:${card.parent}:${card.operation}`
    case 'hotspot':
      return `${card.kind}:${card.operation}:${card.codeFile}`
    case 'silent':
      return `${card.kind}:${card.service}`
    case 'traces':
      return `${card.kind}:${card.label}`
  }
}
