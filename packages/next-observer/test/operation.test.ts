import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector, type NormalizedSpan } from '../src/collector/index.js'
import { computeOperation, findSpeeds, latencyHistogram } from '../src/collector/operation.js'
import { histogramMarkers } from '../ui/src/lib/histogram.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const MIN = 60_000
let seq = 0

function span(name: string, agoMs: number, durationMs: number, extra: { version?: string; kind?: NormalizedSpan['kind']; error?: boolean; service?: string } = {}): NormalizedSpan {
  seq++
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name,
    kind: extra.kind ?? 'internal',
    service: extra.service ?? 'shop',
    serviceVersion: extra.version ?? 'v1',
    scope: 'next-observe',
    startTimeMs: NOW - agoMs,
    durationMs,
    status: extra.error ? 'error' : 'unset',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: [],
  }
}

const opts = { nowMs: NOW, windowMs: 10 * MIN, buckets: 10 }

describe('latencyHistogram', () => {
  it('no calls → null', () => {
    expect(latencyHistogram([])).toBeNull()
  })

  it('equal-width bins up to the p99; slower calls land in the last bin and are counted as overflow', () => {
    // 99 calls of 1…99 ms and one 30 s outlier: p99 = 99 ms.
    const h = latencyHistogram([...Array.from({ length: 99 }, (_, i) => i + 1), 30_000], 11)!
    expect(h).toMatchObject({ total: 100, overflow: 1, p50Ms: 50, p95Ms: 95, p99Ms: 99 })
    expect(h.bins).toHaveLength(11)
    expect(h.bins[0]).toEqual({ fromMs: 0, toMs: 9, count: 8 }) // 1…8 (9 ms starts the next bin)
    expect(h.bins[10]).toMatchObject({ fromMs: 90, toMs: 99, count: 11 }) // 90…99 and the outlier
    expect(h.bins.reduce((sum, b) => sum + b.count, 0)).toBe(100)
  })

  it('microsecond spans still get distinct bin edges', () => {
    // p99 = 0.012 ms: edges rounded to 0.01 ms would all be 0 or 0.01.
    const h = latencyHistogram(Array.from({ length: 12 }, (_, i) => (i + 1) / 1000), 12)!
    expect(new Set(h.bins.map((b) => b.fromMs)).size).toBe(12)
    expect(h.bins[11].toMs).toBeGreaterThan(0)
  })
})

describe('histogramMarkers', () => {
  const labels = (p50Ms: number, p95Ms: number, p99Ms: number, max = p99Ms) => histogramMarkers({ p50Ms, p95Ms, p99Ms }, max).map((m) => m.label)

  it('keeps markers that are far enough apart', () => {
    expect(labels(200, 1500, 2500)).toEqual(['median', 'p95', 'p99'])
  })

  it('drops a marker too close to the last one kept — not to its dropped neighbour', () => {
    // p95 is 5% from the median (dropped); p99 is 10% from the median (kept), though only 5% from p95.
    expect(labels(90, 95, 100)).toEqual(['median', 'p99'])
    expect(labels(100, 100, 100)).toEqual(['median'])
  })
})

describe('findSpeeds', () => {
  it('finds a fast and a slow group with their shares', () => {
    const fast = Array.from({ length: 86 }, (_, i) => 240 + (i % 9) * 5)
    const slow = Array.from({ length: 14 }, (_, i) => 1150 + (i % 5) * 20)
    const speeds = findSpeeds([...slow, ...fast])!
    expect(speeds[0]).toMatchObject({ count: 86, share: 0.86 })
    expect(speeds[1]).toMatchObject({ count: 14, share: 0.14 })
    expect(speeds[0].medianMs).toBeGreaterThanOrEqual(240)
    expect(speeds[0].medianMs).toBeLessThanOrEqual(280)
    expect(speeds[1].medianMs).toBeGreaterThanOrEqual(1150)
  })

  it('one speed with ordinary spread is not two', () => {
    expect(findSpeeds(Array.from({ length: 50 }, (_, i) => 100 + i * 3))).toBeNull() // 100…247 ms
  })

  it('groups less than ×3 apart are not two speeds', () => {
    expect(findSpeeds([...Array(20).fill(100), ...Array(20).fill(250)])).toBeNull()
    expect(findSpeeds([...Array(20).fill(100), ...Array(20).fill(300)])).not.toBeNull()
  })

  it('a few outliers are not a second speed: under 10% or fewer than 3 calls', () => {
    expect(findSpeeds([...Array(95).fill(100), ...Array(5).fill(2000)])).toBeNull()
    expect(findSpeeds([...Array(6).fill(100), 2000, 2100])).toBeNull()
    expect(findSpeeds([...Array(6).fill(100), 2000, 2100, 2200])).not.toBeNull()
  })

  it('too few calls → null', () => {
    expect(findSpeeds([100, 100, 2000, 2000, 2000])).toBeNull()
    expect(findSpeeds([100])).toBeNull()
    expect(findSpeeds([])).toBeNull()
  })

  it('compares on a log scale: a slow tail does not hide two speeds among the fast calls', () => {
    // On a linear scale the five 5 s calls would be "the slow group" (under 10% → nothing reported).
    const speeds = findSpeeds([...Array(40).fill(20), ...Array(40).fill(200), ...Array(5).fill(5000)])!
    expect(speeds[0]).toMatchObject({ medianMs: 20, count: 40 })
    expect(speeds[1]).toMatchObject({ medianMs: 200, count: 45 })
  })
})

describe('computeOperation', () => {
  it('describes one operation by exact name, any span kind, with versions in deploy order', () => {
    const spans = [
      ...Array.from({ length: 6 }, (_, i) => span('chargePayment', (9 - i) * MIN, 200, { version: 'v1' })),
      ...Array.from({ length: 6 }, (_, i) => span('chargePayment', (3 - i * 0.4) * MIN, 1600, { version: 'v2', error: i === 0 })),
      span('chargePaymentRetry', MIN, 50), // a different operation: exact match only
      span('chargePayment', MIN, 70, { service: 'other' }),
    ]
    const d = computeOperation(spans, { ...opts, operation: 'chargePayment', service: 'shop' })
    expect(d.overview.requests.total).toBe(12)
    expect(d.overview.errors.count).toBe(1)
    expect(d.histogram).toMatchObject({ total: 12, p50Ms: 200, p95Ms: 1600 })
    expect(d.versions).toEqual([
      { version: 'v1', count: 6, p50Ms: 200, p95Ms: 200, errorRate: 0 },
      { version: 'v2', count: 6, p50Ms: 1600, p95Ms: 1600, errorRate: 0.17 },
    ])
    expect(d.speeds).toEqual([
      { medianMs: 200, count: 6, share: 0.5 },
      { medianMs: 1600, count: 6, share: 0.5 },
    ])
    expect(d.lastSeenMs).toBe(NOW - MIN)
  })

  it('leaves cold starts out of the distribution and says how many', () => {
    const cold = span('GET /a', MIN, 900, { kind: 'server' })
    const d = computeOperation([cold, ...Array.from({ length: 7 }, () => span('GET /a', 2 * MIN, 30, { kind: 'server' }))], { ...opts, operation: 'GET /a', isColdStart: (s) => s === cold })
    expect(d.coldStarts).toBe(1)
    expect(d.histogram!.total).toBe(7)
    expect(d.speeds).toBeNull()
    expect(d.overview.requests.total).toBe(8)
  })

  it('names the service only when all calls come from one', () => {
    const spans = [...Array.from({ length: 3 }, () => span('query', MIN, 10)), span('query', MIN, 500, { service: 'other' })]
    expect(computeOperation(spans, { ...opts, operation: 'query' }).service).toBeNull()
    expect(computeOperation(spans, { ...opts, operation: 'query', service: 'other' }).service).toBe('other')
    expect(computeOperation(spans.slice(0, 3), { ...opts, operation: 'query' }).service).toBe('shop')
  })

  it('handles more calls than fit into one function call (no spread of the whole list)', () => {
    const many = Array.from({ length: 130_000 }, (_, i) => ({ ...span('hot', 0, 5), startTimeMs: NOW - 9 * MIN + i }))
    expect(computeOperation(many, { ...opts, operation: 'hot' }).lastSeenMs).toBe(NOW - 9 * MIN + 129_999)
  })

  it('an unknown operation is empty, not an error', () => {
    const d = computeOperation([span('a', MIN, 10)], { ...opts, operation: 'nope' })
    expect(d).toMatchObject({ histogram: null, speeds: null, versions: [], coldStarts: 0, lastSeenMs: null, service: null })
    expect(d.overview.requests.total).toBe(0)
  })

  it('on the workshop shop: checkout runs at two speeds — v1 and v2', async () => {
    const storage = await shopStorage()
    const spans = await storage.querySpans({ limit: Number.MAX_SAFE_INTEGER })
    const d = computeOperation(spans, { nowMs: NOW, windowMs: 15 * MIN, buckets: 30, operation: 'POST /api/checkout', isColdStart: (s) => storage.isColdStart(s) })
    expect(d.versions.map((v) => v.version)).toEqual(['v1', 'v2'])
    expect(d.speeds).not.toBeNull()
    expect(d.speeds![1].medianMs).toBeGreaterThan(d.speeds![0].medianMs * 3)
  })
})

describe('GET /api/operation', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('/api/traces?exactOperation lists only traces with exactly that span name', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([span('GET /api/products', MIN, 10, { kind: 'server' }), span('GET /api/products/[id]', MIN, 10, { kind: 'server' })])
    collector = await startCollector({ port: 0, storage, uiDir: false })
    const names = async (query: string) => ((await (await fetch(`${collector!.url}/api/traces?${query}`)).json()) as { rootName: string }[]).map((t) => t.rootName).sort()
    expect(await names('operation=GET%20/api/products')).toEqual(['GET /api/products', 'GET /api/products/[id]'])
    expect(await names('operation=GET%20/api/products&exactOperation=true')).toEqual(['GET /api/products'])
    expect(await names('operation=get%20/api/products&exactOperation=true')).toEqual([])
  })

  it('serves one operation; the name is required', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans(Array.from({ length: 8 }, (_, i) => span('chargePayment', (i + 1) * 10_000, 100 + i)))
    collector = await startCollector({ port: 0, storage, uiDir: false })
    expect((await fetch(`${collector.url}/api/operation`)).status).toBe(400)
    const res = await fetch(`${collector.url}/api/operation?operation=chargePayment&windowMs=${5 * MIN}&toMs=${NOW}`)
    expect(res.status).toBe(200)
    const d = (await res.json()) as { operation: string; histogram: { total: number }; overview: { requests: { total: number } } }
    expect(d).toMatchObject({ operation: 'chargePayment', histogram: { total: 8 }, overview: { requests: { total: 8 } } })
  })
})
