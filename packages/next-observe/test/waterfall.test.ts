import { describe, expect, it } from 'vitest'
import { formatDuration, layoutWaterfall, type WaterfallSpan } from '../ui/src/lib/waterfall.js'

const span = (spanId: string, parentSpanId: string | null, startTimeMs: number, durationMs: number, extra: Partial<WaterfallSpan> = {}): WaterfallSpan => ({
  spanId,
  parentSpanId,
  name: spanId,
  service: 'shop',
  startTimeMs,
  durationMs,
  status: 'unset',
  ...extra,
})

describe('layoutWaterfall', () => {
  it('orders rows depth-first with nesting levels, children by start time', () => {
    const { rows } = layoutWaterfall([
      span('root', null, 0, 100),
      span('b', 'root', 50, 10),
      span('a', 'root', 10, 30),
      span('a1', 'a', 12, 5),
    ])
    expect(rows.map((r) => [r.span.spanId, r.depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
      ['b', 1],
    ])
  })

  it('positions bars as % of the whole trace', () => {
    const { rows, startTimeMs, durationMs } = layoutWaterfall([span('root', null, 1000, 200), span('child', 'root', 1050, 100)])
    expect([startTimeMs, durationMs]).toEqual([1000, 200])
    expect(rows[1]).toMatchObject({ offsetPct: 25, widthPct: 50 })
    expect(rows[0]).toMatchObject({ offsetPct: 0, widthPct: 100 })
  })

  it('keeps tiny spans visible and treats orphans as roots', () => {
    const { rows } = layoutWaterfall([span('root', null, 0, 1000), span('tiny', 'root', 10, 0), span('orphan', 'missing', 20, 5)])
    expect(rows.find((r) => r.span.spanId === 'tiny')!.widthPct).toBeGreaterThan(0)
    expect(rows.find((r) => r.span.spanId === 'orphan')!.depth).toBe(0)
  })

  it('handles an empty trace', () => {
    expect(layoutWaterfall([])).toEqual({ rows: [], startTimeMs: 0, durationMs: 0 })
  })
})

describe('formatDuration', () => {
  it('picks a readable unit', () => {
    expect([formatDuration(0.25), formatDuration(3.456), formatDuration(42.4), formatDuration(2345)]).toEqual(['250µs', '3.46ms', '42ms', '2.35s'])
  })
})
