// The dashboard's numbers, computed in one pass over a time window: request volume by status class, latency, errors,
// the slowest and the busiest routes — each compared with the window just before it ("−13% since last period").
import { percentile } from './memory-storage.js'
import type { NormalizedSpan } from './types.js'

export interface OverviewOptions {
  nowMs: number
  windowMs: number
  /** Number of time buckets in the series. */
  buckets: number
  service?: string
  /** Cold requests count as traffic but stay out of latency — in next dev they include compiling the route. */
  isColdStart?: (span: NormalizedSpan) => boolean
}

export interface RequestBucket {
  startMs: number
  ok: number
  clientErrors: number
  serverErrors: number
}

export interface DurationBucket {
  startMs: number
  /** null when the bucket had no (warm) requests — a gap, not a zero. */
  avgMs: number | null
  p95Ms: number | null
}

export interface RouteRow {
  service: string
  operation: string
  count: number
  p95Ms: number
  errorRate: number
  /** Share of all requests in the window. */
  share: number
  /** Every request of this route was a cold start, so p95 includes compile time (next dev). */
  coldOnly?: true
}

export interface Overview {
  fromMs: number
  toMs: number
  bucketMs: number
  requests: { total: number; perSecond: number; change: number | null; series: RequestBucket[] }
  duration: { avgMs: number | null; p95Ms: number | null; change: number | null; series: DurationBucket[] }
  errors: { count: number; rate: number; change: number | null }
  slowest: RouteRow[]
  busiest: RouteRow[]
}

const TOP = 5

/** A request is a server span — the same definition the anomaly detector uses. */
export const isRequest = (span: NormalizedSpan) => span.kind === 'server'

export function statusCode(span: NormalizedSpan): number | undefined {
  const code = span.attributes['http.status_code'] ?? span.attributes['http.response.status_code']
  const n = typeof code === 'string' ? Number(code) : code
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** 5xx, or an error status without a code: the server failed. 4xx: the client asked for something wrong. */
export function statusClass(span: NormalizedSpan): 'ok' | 'client' | 'server' {
  const code = statusCode(span)
  if (code !== undefined && code >= 500) return 'server'
  if (code !== undefined && code >= 400) return 'client'
  return code === undefined && span.status === 'error' ? 'server' : 'ok'
}

const round = (n: number) => Math.round(n * 100) / 100

/** Relative change, e.g. 0.25 for +25%; null when there is nothing to compare with. */
function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return round((current - previous) / previous)
}

function latency(spans: NormalizedSpan[]): { avgMs: number | null; p95Ms: number | null } {
  if (spans.length === 0) return { avgMs: null, p95Ms: null }
  const sorted = spans.map((s) => s.durationMs).sort((a, b) => a - b)
  return { avgMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length), p95Ms: round(percentile(sorted, 95)) }
}

const isFailure = (s: NormalizedSpan) => statusClass(s) === 'server'

export function computeOverview(spans: NormalizedSpan[], options: OverviewOptions): Overview {
  const { nowMs, windowMs, buckets } = options
  const fromMs = nowMs - windowMs
  const bucketMs = windowMs / buckets
  const cold = options.isColdStart ?? (() => false)
  const requests = spans.filter((s) => isRequest(s) && (!options.service || s.service === options.service))
  const current = requests.filter((s) => s.startTimeMs >= fromMs && s.startTimeMs <= nowMs)
  const previous = requests.filter((s) => s.startTimeMs >= fromMs - windowMs && s.startTimeMs < fromMs)
  const warm = (list: NormalizedSpan[]) => list.filter((s) => !cold(s))

  const requestSeries: RequestBucket[] = []
  const byBucket: NormalizedSpan[][] = []
  for (let i = 0; i < buckets; i++) {
    requestSeries.push({ startMs: fromMs + i * bucketMs, ok: 0, clientErrors: 0, serverErrors: 0 })
    byBucket.push([])
  }
  for (const s of current) {
    // The last bucket also takes a request exactly at nowMs.
    const i = Math.min(Math.floor((s.startTimeMs - fromMs) / bucketMs), buckets - 1)
    const kind = statusClass(s)
    if (kind === 'server') requestSeries[i].serverErrors++
    else if (kind === 'client') requestSeries[i].clientErrors++
    else requestSeries[i].ok++
    if (!cold(s)) byBucket[i].push(s)
  }

  const now = latency(warm(current))
  const before = latency(warm(previous))
  const failures = current.filter(isFailure).length
  const failuresBefore = previous.filter(isFailure).length

  const routes = new Map<string, NormalizedSpan[]>()
  for (const s of current) {
    const key = `${s.service}\u0000${s.name}`
    const group = routes.get(key)
    if (group) group.push(s)
    else routes.set(key, [s])
  }
  const rows: RouteRow[] = [...routes.values()].map((group) => {
    // A route seen only cold still gets a number — the compile time is better than nothing — but it is flagged.
    const coldOnly = warm(group).length === 0
    const timed = coldOnly ? group : warm(group)
    return {
      service: group[0].service,
      operation: group[0].name,
      count: group.length,
      p95Ms: latency(timed).p95Ms!,
      errorRate: round(group.filter(isFailure).length / group.length),
      share: round(group.length / current.length),
      ...(coldOnly ? { coldOnly: true as const } : {}),
    }
  })

  return {
    fromMs,
    toMs: nowMs,
    bucketMs,
    requests: {
      total: current.length,
      perSecond: round(current.length / (windowMs / 1000)),
      change: change(current.length, previous.length),
      series: requestSeries,
    },
    duration: {
      ...now,
      change: change(now.p95Ms, before.p95Ms),
      series: byBucket.map((list, i) => ({ startMs: requestSeries[i].startMs, ...latency(list) })),
    },
    errors: {
      count: failures,
      rate: current.length ? round(failures / current.length) : 0,
      change: change(failures, failuresBefore),
    },
    // A route whose only request compiled it would top the list in next dev: real latency comes first.
    slowest: [...rows].sort((a, b) => Number(a.coldOnly ?? false) - Number(b.coldOnly ?? false) || b.p95Ms - a.p95Ms).slice(0, TOP),
    busiest: [...rows].sort((a, b) => b.count - a.count || b.p95Ms - a.p95Ms).slice(0, TOP),
  }
}
