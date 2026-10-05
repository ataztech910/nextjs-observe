// One operation up close: its overview, how its latency is distributed, and whether it runs at two speeds.
import { percentile } from './memory-storage.js'
import { computeOverview, statusClass, type Overview, type OverviewOptions } from './overview.js'
import type { NormalizedSpan } from './types.js'

export interface HistogramBin {
  fromMs: number
  toMs: number
  count: number
}

export interface Histogram {
  /** Equal-width bins from 0 to the p99; the last one also holds everything slower (see `overflow`). */
  bins: HistogramBin[]
  /** How many calls were slower than the last bin's upper edge. */
  overflow: number
  total: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export interface Speed {
  medianMs: number
  count: number
  /** Share of all calls, 0…1. */
  share: number
}

export interface VersionRow {
  version: string
  count: number
  p50Ms: number
  p95Ms: number
  errorRate: number
}

export interface OperationDetails {
  service: string | null
  operation: string
  overview: Overview
  /** null without calls in the window. Cold starts are left out (counted in `coldStarts`). */
  histogram: Histogram | null
  /** Two clearly separate latency groups — a cache hit and a miss, a fast path and a slow one, v1 and v2. */
  speeds: [Speed, Speed] | null
  versions: VersionRow[]
  coldStarts: number
  lastSeenMs: number | null
}

const round = (n: number) => Math.round(n * 100) / 100
const median = (sorted: number[]) => percentile(sorted, 50)

export function latencyHistogram(durations: number[], bins = 24): Histogram | null {
  if (durations.length === 0) return null
  const sorted = [...durations].sort((a, b) => a - b)
  const p99Ms = percentile(sorted, 99)
  // The p99 as the upper edge: one 30 s outlier must not squeeze everything else into the first bin.
  const max = p99Ms > 0 ? p99Ms : 1
  const width = max / bins
  const result: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ fromMs: round(i * width), toMs: round((i + 1) * width), count: 0 }))
  let overflow = 0
  for (const d of sorted) {
    if (d > max) overflow++
    result[Math.min(Math.floor(d / width), bins - 1)].count++
  }
  return { bins: result, overflow, total: sorted.length, p50Ms: round(median(sorted)), p95Ms: round(percentile(sorted, 95)), p99Ms: round(p99Ms) }
}

/**
 * Splits the calls into a fast and a slow group where that split explains the most variance (1-D 2-means on log
 * latency — latency is multiplicative: 20 → 40 ms is as big a step as 1 → 2 s). Reported only when the groups are
 * really apart: medians ×3 or more, and the smaller group is at least 10% of the calls and at least 3 of them.
 */
export function findSpeeds(durations: number[]): [Speed, Speed] | null {
  const sorted = durations.filter((d) => d > 0).sort((a, b) => a - b)
  const n = sorted.length
  const logs = sorted.map(Math.log)
  const prefix = [0]
  const prefixSq = [0]
  for (const v of logs) {
    prefix.push(prefix[prefix.length - 1] + v)
    prefixSq.push(prefixSq[prefixSq.length - 1] + v * v)
  }
  // Sum of squared deviations of logs[from, to).
  const sse = (from: number, to: number) => prefixSq[to] - prefixSq[from] - (prefix[to] - prefix[from]) ** 2 / (to - from)
  let best = 1
  for (let k = 2; k < n; k++) if (sse(0, k) + sse(k, n) < sse(0, best) + sse(best, n)) best = k
  const fast = sorted.slice(0, best)
  const slow = sorted.slice(best)
  const smaller = Math.min(fast.length, slow.length)
  if (smaller < 3 || smaller / n < 0.1 || median(slow) < median(fast) * 3) return null
  const speed = (group: number[]): Speed => ({ medianMs: round(median(group)), count: group.length, share: round(group.length / n) })
  return [speed(fast), speed(slow)]
}

export function computeOperation(spans: NormalizedSpan[], options: OverviewOptions & { operation: string }): OperationDetails {
  const cold = options.isColdStart ?? (() => false)
  const fromMs = options.nowMs - options.windowMs
  const calls = spans.filter(
    (s) => s.name === options.operation && (!options.service || s.service === options.service) && s.startTimeMs >= fromMs && s.startTimeMs <= options.nowMs,
  )
  const warm = calls.filter((s) => !cold(s))
  const durations = warm.map((s) => s.durationMs)

  // Deploy order = order of first appearance.
  const byVersion = new Map<string, NormalizedSpan[]>()
  for (const s of [...warm].sort((a, b) => a.startTimeMs - b.startTimeMs)) {
    const version = s.serviceVersion ?? 'unknown'
    byVersion.set(version, [...(byVersion.get(version) ?? []), s])
  }
  const versions: VersionRow[] = [...byVersion].map(([version, list]) => {
    const sorted = list.map((s) => s.durationMs).sort((a, b) => a - b)
    return {
      version,
      count: list.length,
      p50Ms: round(median(sorted)),
      p95Ms: round(percentile(sorted, 95)),
      errorRate: round(list.filter((s) => statusClass(s) === 'server').length / list.length),
    }
  })

  return {
    service: options.service ?? calls[0]?.service ?? null,
    operation: options.operation,
    overview: computeOverview(spans, options),
    histogram: latencyHistogram(durations),
    speeds: findSpeeds(durations),
    versions,
    coldStarts: calls.length - warm.length,
    lastSeenMs: calls.length ? Math.max(...calls.map((s) => s.startTimeMs)) : null,
  }
}
