import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector, type NormalizedSpan } from '../src/collector/index.js'
import { computeOverview, statusClass } from '../src/collector/overview.js'

const NOW = 1_800_000_000_000
const MIN = 60_000
let seq = 0

function req(name: string, agoMs: number, durationMs: number, extra: { code?: number; error?: boolean; kind?: NormalizedSpan['kind']; service?: string } = {}): NormalizedSpan {
  seq++
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name,
    kind: extra.kind ?? 'server',
    service: extra.service ?? 'shop',
    serviceVersion: 'v1',
    scope: 'next.js',
    startTimeMs: NOW - agoMs,
    durationMs,
    status: extra.error ? 'error' : 'unset',
    statusMessage: null,
    attributes: extra.code === undefined ? {} : { 'http.status_code': extra.code },
    resource: {},
    events: [],
  }
}

const opts = { nowMs: NOW, windowMs: 10 * MIN, buckets: 10 }

describe('statusClass', () => {
  it('5xx and an error without a code are server failures; 4xx is the client', () => {
    expect(statusClass(req('a', 0, 1, { code: 503 }))).toBe('server')
    expect(statusClass(req('a', 0, 1, { error: true }))).toBe('server')
    expect(statusClass(req('a', 0, 1, { code: 404 }))).toBe('client')
    // A handled error that still answered 200 is not a failed request.
    expect(statusClass(req('a', 0, 1, { code: 200, error: true }))).toBe('ok')
    expect(statusClass({ ...req('a', 0, 1), attributes: { 'http.response.status_code': '500' } })).toBe('server')
  })
})

describe('computeOverview', () => {
  it('counts only server requests of the window, by status class, into time buckets', () => {
    const o = computeOverview(
      [
        req('GET /a', 30_000, 10, { code: 200 }), // last bucket
        req('GET /a', 0, 10, { code: 500 }), // exactly now → last bucket
        req('GET /a', 9.5 * MIN, 10, { code: 404 }), // first bucket
        req('fetch', 60_000, 10, { kind: 'client' }), // not a request
        req('GET /old', 25 * MIN, 10), // older than both windows
      ],
      opts,
    )
    expect(o.requests.total).toBe(3)
    expect(o.requests.series).toHaveLength(10)
    expect(o.requests.series[0]).toMatchObject({ startMs: NOW - 10 * MIN, ok: 0, clientErrors: 1, serverErrors: 0 })
    expect(o.requests.series[9]).toMatchObject({ ok: 1, clientErrors: 0, serverErrors: 1 })
    expect(o.requests.perSecond).toBe(0.01) // 3 / 600 s
    expect(o.errors).toMatchObject({ count: 1, rate: 0.33 })
  })

  it('compares with the window before it', () => {
    const o = computeOverview(
      [
        ...[1, 2, 3, 4].map((m) => req('GET /a', m * MIN, 100)),
        ...[11, 12].map((m) => req('GET /a', m * MIN, 50)),
      ],
      opts,
    )
    expect(o.requests.change).toBe(1) // 4 vs 2 → +100%
    expect(o.duration.change).toBe(1) // p95 100 vs 50
    expect(o.errors.change).toBeNull() // nothing failed before: no ratio
  })

  it('keeps cold starts in traffic but out of latency', () => {
    const cold = req('GET /a', MIN, 5000)
    const o = computeOverview([cold, req('GET /a', 2 * MIN, 20)], { ...opts, isColdStart: (s) => s === cold })
    expect(o.requests.total).toBe(2)
    expect(o.duration).toMatchObject({ avgMs: 20, p95Ms: 20 })
    expect(o.slowest[0]).toMatchObject({ operation: 'GET /a', count: 2, p95Ms: 20 })
  })

  it('a route seen only cold is flagged and ranked after real latency', () => {
    const notFound = req('GET /_not-found', MIN, 834, { code: 404 })
    const o = computeOverview([notFound, req('GET /api/products', MIN, 110), req('GET /api/products', 2 * MIN, 100)], { ...opts, isColdStart: (s) => s === notFound })
    expect(o.slowest.map((r) => r.operation)).toEqual(['GET /api/products', 'GET /_not-found'])
    expect(o.slowest[1]).toMatchObject({ coldOnly: true, p95Ms: 834 })
    expect(o.slowest[0].coldOnly).toBeUndefined()
  })

  it('an empty bucket is a gap (null), not zero latency', () => {
    const o = computeOverview([req('GET /a', 30_000, 40)], opts)
    expect(o.duration.series[0]).toMatchObject({ avgMs: null, p95Ms: null })
    expect(o.duration.series[9]).toMatchObject({ avgMs: 40, p95Ms: 40 })
  })

  it('ranks routes: slowest by p95, busiest by count, top 5', () => {
    const spans = [
      ...Array.from({ length: 6 }, () => req('GET /busy', MIN, 10)),
      req('POST /slow', MIN, 2000, { code: 500 }),
      req('POST /slow', MIN, 1800),
      ...['b', 'c', 'd', 'e', 'f'].map((n) => req(`GET /${n}`, MIN, 100)),
    ]
    const o = computeOverview(spans, opts)
    expect(o.slowest).toHaveLength(5)
    expect(o.slowest[0]).toMatchObject({ operation: 'POST /slow', count: 2, errorRate: 0.5 })
    expect(o.busiest[0]).toMatchObject({ operation: 'GET /busy', count: 6, share: 0.46 })
  })

  it('filters by service', () => {
    const o = computeOverview([req('GET /a', MIN, 10), req('GET /a', MIN, 10, { service: 'other' })], { ...opts, service: 'other' })
    expect(o.requests.total).toBe(1)
  })
})

describe('GET /api/overview', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('serves the overview for a window ending at toMs, cold starts from the storage', async () => {
    const storage = new MemoryStorage()
    const first = { ...req('GET /a', 2 * MIN, 900), resource: { 'service.instance.id': 'p1' } }
    const second = { ...req('GET /a', MIN, 30), resource: { 'service.instance.id': 'p1' } }
    await storage.insertSpans([first, second])
    collector = await startCollector({ port: 0, storage, uiDir: false })
    const res = await fetch(`${collector.url}/api/overview?windowMs=${5 * MIN}&toMs=${NOW}`)
    expect(res.status).toBe(200)
    const o = await res.json()
    expect(o).toMatchObject({ fromMs: NOW - 5 * MIN, toMs: NOW, bucketMs: 10_000 })
    expect(o.requests.total).toBe(2)
    expect(o.duration.p95Ms).toBe(30) // the cold first request is left out
  })

  it('rejects a window outside 1 min … 24 h', async () => {
    collector = await startCollector({ port: 0, uiDir: false })
    expect((await fetch(`${collector.url}/api/overview?windowMs=1000`)).status).toBe(400)
    expect((await fetch(`${collector.url}/api/overview?windowMs=${2 * 86_400_000}`)).status).toBe(400)
    expect((await fetch(`${collector.url}/api/overview`)).status).toBe(200)
  })
})
