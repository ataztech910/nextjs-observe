import type { HistogramMetricPoint } from './metric-types.js'

export interface HistogramQuantile {
  /** null means the bucket is unbounded; an absent estimate is not zero. */
  lowerBound: number | null
  upperBound: number | null
  estimate: number | null
  approximate: true
}
/** One point's distribution only. Never add cumulative snapshots or average percentiles. */
export function histogramQuantiles(point: HistogramMetricPoint): Record<string, HistogramQuantile> | null {
  const count = BigInt(point.count)
  if ((point.flags & 1) || count === 0n || point.bucketCounts.length === 0) return null
  const result: Record<string, HistogramQuantile> = {}
  for (const percentile of [50, 75, 90, 95, 99]) {
    const rank = (BigInt(percentile) * count + 99n) / 100n
    let before = 0n
    for (let i = 0; i < point.bucketCounts.length; i++) {
      const size = BigInt(point.bucketCounts[i])
      if (before + size >= rank && size > 0n) {
        const lowerBound = i === 0 ? point.min ?? null : Math.max(point.explicitBounds[i - 1], point.min ?? -Infinity)
        const upperBound = i === point.explicitBounds.length ? point.max ?? null : Math.min(point.explicitBounds[i], point.max ?? Infinity)
        const fraction = Number(rank - before) / Number(size)
        const interpolated = lowerBound === null || upperBound === null ? NaN : lowerBound * (1 - fraction) + upperBound * fraction
        const estimate = Number.isFinite(interpolated) ? interpolated : null
        result[`p${percentile}`] = { lowerBound, upperBound, estimate, approximate: true }
        break
      }
      before += size
    }
  }
  return result
}
