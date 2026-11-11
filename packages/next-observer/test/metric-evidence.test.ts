import { describe, expect, it } from 'vitest'
import { decodeOtlpMetrics, type HistogramMetricPoint } from '../src/collector/index.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'
import { histogramBuckets, exemplarTarget, metricValue } from '../ui/src/lib/metric-evidence.js'
import { histogramQuantiles } from '../src/collector/metric-query.js'
function point(): HistogramMetricPoint {
  const histogram = decodeOtlpMetrics(performanceMetrics().json).find((m) => m.type === 'histogram')!
  if (histogram.type !== 'histogram') throw Error('fixture missing histogram')
  return histogram.point
}
describe('metric evidence projection', () => {
  it('uses OTLP lower-exclusive / upper-inclusive intervals and retains exact counts', () => {
    expect(histogramBuckets(point())).toEqual([
      { interval: '(−∞, 0.1]', count: '2', widthPct: 50 },
      { interval: '(0.1, 0.5]', count: '4', widthPct: 100 },
      { interval: '(0.5, 1]', count: '3', widthPct: 75 },
      { interval: '(1, +∞)', count: '1', widthPct: 25 },
    ])
  })
  it('keeps counts above safe integers exact and does not inflate zero-count bars', () => {
    const p = { ...point(), count: '9007199254740993', explicitBounds: [0], bucketCounts: ['0', '9007199254740993'] }
    expect(histogramBuckets(p)).toEqual([
      { interval: '(−∞, 0]', count: '0', widthPct: 0 },
      { interval: '(0, +∞)', count: '9007199254740993', widthPct: 100 },
    ])
    expect(histogramBuckets({ ...p, count: '0', bucketCounts: ['0', '0'] }).every((b) => b.widthPct === 0)).toBe(true)
    expect(histogramBuckets({ ...p, bucketCounts: [], explicitBounds: [] })).toEqual([])
  })
  it('keeps cumulative point populations separate and reports quantile bounds in source units', () => {
    const first = point(), second = { ...first, count: '20', bucketCounts: ['4', '8', '6', '2'] }
    expect(histogramBuckets(first).map((b) => b.count)).toEqual(['2', '4', '3', '1'])
    expect(histogramBuckets(second).map((b) => b.count)).toEqual(['4', '8', '6', '2'])
    expect(histogramQuantiles(first)?.p95).toEqual({ lowerBound: 1, upperBound: 2, estimate: 2, approximate: true })
    const unbounded = { ...first }; delete unbounded.max
    expect(histogramQuantiles(unbounded)?.p95).toEqual({ lowerBound: 1, upperBound: null, estimate: null, approximate: true })
    expect(histogramQuantiles({ ...first, flags: 1 })).toBeNull()
    expect(histogramQuantiles({ ...first, count: '0', bucketCounts: ['0','0','0','0'] })).toBeNull()
  })
  it('constructs only valid nonzero exemplar trace/span references', () => {
    const traceId = 'a'.repeat(32), spanId = 'b'.repeat(16)
    expect(exemplarTarget({ traceId, spanId })).toEqual({ trace: traceId, span: spanId })
    for (const absent of ['', '0'.repeat(16), 'invalid']) expect(exemplarTarget({ traceId, spanId: absent })).toEqual({ trace: traceId, span: undefined })
    for (const absent of ['', '0'.repeat(32), '../path', 'A'.repeat(32)]) expect(exemplarTarget({ traceId: absent, spanId })).toBeNull()
  })
  it('preserves zero, nonfinite source tokens and int64 values while distinguishing absence', () => {
    expect(metricValue(0)).toBe('0'); expect(metricValue(undefined)).toBe('—')
    expect(metricValue('NaN')).toBe('NaN'); expect(metricValue('Infinity')).toBe('Infinity')
    expect(metricValue('9007199254740993')).toBe('9007199254740993')
  })
})
