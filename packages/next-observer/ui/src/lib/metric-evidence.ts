import type { HistogramMetricPoint, MetricExemplar } from '../../../src/collector/metric-types.js'

export interface HistogramBucket { interval: string; count: string; widthPct: number }
/** OTLP explicit buckets are (lower, upper]; integer counts remain strings, even above Number.MAX_SAFE_INTEGER. */
export function histogramBuckets(point: HistogramMetricPoint): HistogramBucket[] {
  const counts = point.bucketCounts.map((count) => BigInt(count))
  let largest = 0n
  for (const count of counts) if (count > largest) largest = count
  return counts.map((count, i) => ({
    interval: `(${i === 0 ? '−∞' : point.explicitBounds[i - 1]}, ${i === point.explicitBounds.length ? '+∞' : point.explicitBounds[i]}${i === point.explicitBounds.length ? ')' : ']'}`,
    count: point.bucketCounts[i],
    // Visual scale only: no integer count is converted to a floating point population.
    widthPct: largest === 0n ? 0 : Number(count * 10000n / largest) / 100,
  }))
}
export function exemplarTarget(exemplar: Pick<MetricExemplar, 'traceId' | 'spanId'>): { trace: string; span?: string } | null {
  if (!/^[0-9a-f]{32}$/.test(exemplar.traceId) || /^0+$/.test(exemplar.traceId)) return null
  const span = /^[0-9a-f]{16}$/.test(exemplar.spanId) && !/^0+$/.test(exemplar.spanId) ? exemplar.spanId : undefined
  return { trace: exemplar.traceId, span }
}
export function metricValue(value: number | string | undefined): string { return value === undefined ? '—' : String(value) }
