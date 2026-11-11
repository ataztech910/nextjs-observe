import { describe, expect, it } from 'vitest'
import { decodeOtlpMetrics } from '../src/collector/metric-decode.js'
import { MemoryMetricStorage } from '../src/collector/metric-storage.js'
import { histogramQuantiles } from '../src/collector/metric-query.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'
const points = () => decodeOtlpMetrics(performanceMetrics().json)
const histogram = () => { const m = points()[3]; if (m.type !== 'histogram') throw new Error('bad fixture'); return m }

describe('raw metric storage', () => {
  it('deduplicates concurrent retry batches and attributes independent of key ordering', async () => {
    const storage = new MemoryMetricStorage()
    const a = points(); const b = structuredClone(a)
    for (const m of b) { m.resource.attributes!.reverse(); m.point.attributes.reverse() }
    await Promise.all([storage.insertMetrics(a), storage.insertMetrics(b)])
    expect((await storage.queryMetrics()).total).toBe(4)
    a[0].point.timeUnixNano = '1'
    expect((await storage.queryMetrics()).points[0].point.timeUnixNano).toBe('1800000001123456789')
  })
  it('preserves shared resource/scope references across one batch rather than duplicating them per point', async () => {
    const storage = new MemoryMetricStorage()
    const source = points()
    await storage.insertMetrics(source)
    const q = await storage.queryMetrics()
    expect(q.points[0].resource).toBe(q.points[1].resource)
    expect(q.points[0].scope).toBe(q.points[1].scope)
    source[0].resource.attributes![0].value = { stringValue: 'mutated' }
    expect((await storage.queryMetrics({ service: 'metric-fixture' })).total).toBe(4)
  })
  it('rejects conflicting numeric or exemplar populations atomically', async () => {
    const storage = new MemoryMetricStorage()
    const a = points()
    await storage.insertMetrics(a)
    const changed = structuredClone(a[0]); if (changed.type !== 'sum') throw new Error('fixture')
    changed.point.asInt = '999'
    const fresh = structuredClone(a[1]); fresh.name = 'fresh'
    await expect(storage.insertMetrics([fresh, changed])).rejects.toThrow(/conflicting/)
    expect((await storage.queryMetrics()).total).toBe(4)
    const newExemplar = structuredClone(a[2])
    newExemplar.point.exemplars.push({ filteredAttributes: [], timeUnixNano: a[2].point.timeUnixNano, asInt: '42', traceId: '', spanId: '' })
    await expect(storage.insertMetrics([newExemplar])).rejects.toThrow(/conflicting/)
  })
  it('keeps cumulative resets/checkpoints, late intervals and schema changes as raw points, never sums them', async () => {
    const storage = new MemoryMetricStorage()
    const a = histogram(); a.aggregationTemporality = 2
    const checkpoint = structuredClone(a); checkpoint.point.timeUnixNano = '1800000002123456789'; checkpoint.point.count = '20'; checkpoint.point.bucketCounts = ['4', '8', '6', '2']
    const reset = structuredClone(a); reset.point.startTimeUnixNano = checkpoint.point.timeUnixNano; reset.point.timeUnixNano = '1800000003123456789'
    const delta = structuredClone(a); delta.aggregationTemporality = 1
    const bounds = structuredClone(checkpoint); bounds.point.timeUnixNano = '1800000004123456789'; bounds.point.explicitBounds = [0.1, 0.5, 2]
    await storage.insertMetrics([reset, checkpoint, delta, a, bounds])
    const q = await storage.queryMetrics()
    expect(q.total).toBe(5)
    expect(q.points.map((m) => m.point.timeUnixNano)).toEqual([...q.points.map((m) => m.point.timeUnixNano)].sort())
    expect(q.points.filter((m) => m.type === 'histogram').map((m) => m.point.count)).toContain('20')
    expect(q.points[0]).not.toHaveProperty('mergedCount')
  })
  it('filters/pages complete raw records, exposes eviction and protects stored values from query mutations', async () => {
    const storage = new MemoryMetricStorage(3)
    await storage.insertMetrics(points())
    const q = await storage.queryMetrics({ service: 'metric-fixture', limit: 2 })
    expect(q).toMatchObject({ total: 3, truncated: true, historyComplete: false })
    const last = await storage.queryMetrics({ offset: 2, limit: 2 })
    expect(last.points).toHaveLength(1)
    expect(last.truncated).toBe(true)
    q.points[0].name = 'mutated'
    expect((await storage.queryMetrics({ name: 'mutated' })).total).toBe(0)
    expect((await storage.queryMetrics({ name: 'interaction.duration' })).total).toBe(1)
    expect((await storage.queryMetrics({ service: 'other' })).total).toBe(0)
    expect((await storage.queryMetrics({ toMs: 1 })).total).toBe(0)
  })
  it('caps query bytes as well as point count, with an explicit continuation offset', async () => {
    const source = points()
    // One record fits; two repeated resource/scope envelopes would exceed this page budget.
    const budget = Math.max(...source.map((p) => Buffer.byteLength(JSON.stringify(p)))) + 1
    const storage = new MemoryMetricStorage(100, budget)
    await storage.insertMetrics(source)
    const first = await storage.queryMetrics()
    expect(first.points).toHaveLength(1)
    expect(first.nextOffset).toBe(1)
    expect(first.truncated).toBe(true)
    const next = await storage.queryMetrics({ offset: first.nextOffset! })
    expect(next.points[0].name).not.toBe(first.points[0].name)
  })
  it.each([{ limit: 0 }, { limit: 1001 }, { offset: -1 }, { limit: 1.5 }, { fromMs: Infinity }, { fromMs: 1e308 }, { fromMs: 2, toMs: 1 }])('rejects invalid query %j', async (filter) => {
    await expect(new MemoryMetricStorage().queryMetrics(filter)).rejects.toThrow()
  })
})

describe('explicit histogram quantile bounds', () => {
  it('returns bucket bounds/approximate estimates for one population', () => {
    const q = histogramQuantiles(histogram().point)!
    expect(q.p50).toMatchObject({ lowerBound: 0.1, upperBound: 0.5, approximate: true })
    expect(q.p50.estimate).toBeCloseTo(0.4)
    expect(q.p75).toMatchObject({ lowerBound: 0.5, upperBound: 1, approximate: true })
    expect(q.p75.estimate).toBeCloseTo(5 / 6)
    expect(q.p95).toEqual({ lowerBound: 1, upperBound: 2, estimate: 2, approximate: true })
  })
  it('does not invent quantiles from open-ended buckets, empty points, missing values or aggregate-only populations', () => {
    const p = histogram().point
    delete p.min; delete p.max
    expect(histogramQuantiles(p)!.p95).toEqual({ lowerBound: 1, upperBound: null, estimate: null, approximate: true })
    p.count = '0'; expect(histogramQuantiles(p)).toBeNull()
    p.count = '10'; p.flags = 1; expect(histogramQuantiles(p)).toBeNull()
    p.flags = 0; p.bucketCounts = []; expect(histogramQuantiles(p)).toBeNull()
  })
  it('uses integer ranks for counts larger than the JS safe range', () => {
    const p = histogram().point
    p.count = '9007199254740993'; p.bucketCounts = ['9007199254740993']; p.explicitBounds = []; p.min = 0; p.max = 1
    expect(histogramQuantiles(p)!.p50).toMatchObject({ lowerBound: 0, upperBound: 1, approximate: true })
    expect(histogramQuantiles(p)!.p50.estimate).toBeCloseTo(0.5)
  })
})
