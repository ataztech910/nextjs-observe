import { describe, expect, it } from 'vitest'
import { criticalPath, selfTimes, standing, timeByOperation } from '../ui/src/lib/trace-analysis.js'
import type { WaterfallSpan } from '../ui/src/lib/waterfall.js'

const span = (spanId: string, parentSpanId: string | null, startTimeMs: number, durationMs: number, name = spanId, service = 'shop'): WaterfallSpan => ({
  spanId,
  parentSpanId,
  name,
  service,
  startTimeMs,
  durationMs,
  status: 'unset',
})

const self = (spans: WaterfallSpan[]) => Object.fromEntries(selfTimes(spans))
const path = (spans: WaterfallSpan[]) => [...criticalPath(spans)].sort()

describe('selfTimes', () => {
  it('duration minus sequential children', () => {
    expect(self([span('root', null, 0, 100), span('a', 'root', 10, 30), span('b', 'root', 50, 40)])).toEqual({ root: 30, a: 30, b: 40 })
  })

  it('parallel children are not subtracted twice', () => {
    // a and b overlap from 20 to 40: together they cover 10…60 = 50 ms, not 30 + 40 = 70.
    expect(self([span('root', null, 0, 100), span('a', 'root', 10, 30), span('b', 'root', 20, 40)]).root).toBe(50)
    // Sum of children (160) exceeds the parent (100): self is what they leave uncovered, not a negative number.
    expect(self([span('root', null, 0, 100), span('a', 'root', 0, 80), span('b', 'root', 10, 80)]).root).toBe(10)
  })

  it('a child that outlives its parent is clipped to it', () => {
    // The child covers 60…100 of the parent, the rest of it runs after the parent ended.
    expect(self([span('root', null, 0, 100), span('late', 'root', 60, 500)]).root).toBe(60)
    // Entirely outside the parent: covers nothing.
    expect(self([span('root', null, 0, 100), span('after', 'root', 150, 50)]).root).toBe(100)
  })

  it('never goes below zero from floating-point error', () => {
    // 0.1 + 0.2 − 0.1 = 0.20000000000000004 > 0.2: a child covering its parent exactly would leave −4e-17.
    expect(self([span('root', null, 0.1, 0.2), span('same', 'root', 0.1, 0.2)]).root).toBe(0)
  })

  it('only direct children count; a span whose parent is missing is its own root', () => {
    const spans = [span('root', null, 0, 100), span('a', 'root', 0, 60), span('deep', 'a', 0, 50), span('orphan', 'gone', 5, 20)]
    expect(self(spans)).toEqual({ root: 40, a: 10, deep: 50, orphan: 20 })
  })
})

describe('criticalPath', () => {
  it('empty trace → empty path', () => {
    expect(path([])).toEqual([])
  })

  it('sequential children are all on the path', () => {
    expect(path([span('root', null, 0, 100), span('a', 'root', 0, 40), span('b', 'root', 50, 50)])).toEqual(['a', 'b', 'root'])
  })

  it('of parallel children only the one that finishes last holds the parent back', () => {
    const spans = [span('root', null, 0, 100), span('fast', 'root', 0, 20), span('slow', 'root', 0, 95), span('inner', 'slow', 10, 80), span('innerFast', 'fast', 0, 10)]
    expect(path(spans)).toEqual(['inner', 'root', 'slow'])
  })

  it('walks backwards: what ran before the last child is on the path too', () => {
    // prepare (0…30) → then two parallel calls; the longer one (30…100) decides, the shorter (30…50) does not.
    const spans = [span('root', null, 0, 100), span('prepare', 'root', 0, 30), span('long', 'root', 30, 70), span('short', 'root', 30, 20)]
    expect(path(spans)).toEqual(['long', 'prepare', 'root'])
  })

  it('a child still running after its parent ended did not hold the parent back', () => {
    expect(path([span('root', null, 0, 100), span('background', 'root', 50, 500), span('work', 'root', 0, 90)])).toEqual(['root', 'work'])
  })

  it('with several roots, starts from the one that ends last', () => {
    expect(path([span('early', null, 0, 10), span('late', null, 5, 100), span('child', 'late', 10, 50)])).toEqual(['child', 'late'])
  })
})

describe('timeByOperation', () => {
  it('sums self and total time per operation, biggest self time first, with its share of the trace', () => {
    const spans = [
      span('r', null, 0, 100, 'GET /api/products'),
      span('l', 'r', 0, 90, 'listProducts'),
      span('g1', 'l', 0, 20, 'getProductById'),
      span('g2', 'l', 20, 20, 'getProductById'),
      span('g3', 'l', 40, 20, 'getProductById'),
    ]
    expect(timeByOperation(spans, 100)).toEqual([
      { name: 'getProductById', service: 'shop', calls: 3, selfMs: 60, totalMs: 60, selfShare: 0.6 },
      { name: 'listProducts', service: 'shop', calls: 1, selfMs: 30, totalMs: 90, selfShare: 0.3 },
      { name: 'GET /api/products', service: 'shop', calls: 1, selfMs: 10, totalMs: 100, selfShare: 0.1 },
    ])
  })

  it('keeps same-named operations of different services apart', () => {
    const rows = timeByOperation([span('a', null, 0, 10, 'GET', 'shop'), span('b', null, 0, 30, 'GET', 'shop-browser')], 30)
    expect(rows.map((r) => [r.service, r.selfMs])).toEqual([
      ['shop-browser', 30],
      ['shop', 10],
    ])
  })
})

describe('standing', () => {
  it('slow above the p95, fast below the median, typical in between (edges included)', () => {
    const others = { p50Ms: 200, p95Ms: 320 }
    expect(standing(2510, others)).toBe('slow')
    expect(standing(320, others)).toBe('typical')
    expect(standing(200, others)).toBe('typical')
    expect(standing(180, others)).toBe('fast')
  })
})
