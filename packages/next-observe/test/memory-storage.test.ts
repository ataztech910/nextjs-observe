import { describe, expect, it } from 'vitest'
import { MemoryStorage, percentile } from '../src/collector/memory-storage.js'
import type { NormalizedSpan } from '../src/collector/types.js'

let seq = 0
function span(overrides: Partial<NormalizedSpan> & { traceId: string }): NormalizedSpan {
  seq++
  return {
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name: 'op',
    kind: 'internal',
    service: 'shop',
    serviceVersion: 'v1',
    scope: null,
    startTimeMs: 1000,
    durationMs: 10,
    status: 'unset',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: [],
    ...overrides,
  }
}
const T = (n: number) => n.toString(16).padStart(32, '0')

describe('percentile (nearest rank)', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1)
  it('matches textbook values', () => {
    expect([percentile(values, 50), percentile(values, 95), percentile(values, 99), percentile(values, 100)]).toEqual([50, 95, 99, 100])
    expect(percentile([7], 99)).toBe(7)
    expect(percentile([], 50)).toBe(0)
  })
})

describe('MemoryStorage.queryTraces', () => {
  async function seeded() {
    const storage = new MemoryStorage()
    const root1 = span({ traceId: T(1), name: 'GET /', startTimeMs: 1000, durationMs: 50 })
    const root2 = span({ traceId: T(2), name: 'POST /api/checkout', startTimeMs: 2000, durationMs: 2400, service: 'shop' })
    await storage.insertSpans([
      root1,
      span({ traceId: T(1), parentSpanId: root1.spanId, name: 'render Page', startTimeMs: 1005, durationMs: 30 }),
      root2,
      span({ traceId: T(2), parentSpanId: root2.spanId, name: 'chargePayment', startTimeMs: 2010, durationMs: 2300, status: 'error', service: 'payments' }),
      span({ traceId: T(3), name: 'inventory.check', startTimeMs: 3000, durationMs: 5, service: 'inventory' }),
    ])
    return storage
  }

  it('summarizes each trace and sorts newest first', async () => {
    const traces = await (await seeded()).queryTraces()
    expect(traces.map((t) => t.traceId)).toEqual([T(3), T(2), T(1)])
    expect(traces[1]).toEqual({
      traceId: T(2),
      rootName: 'POST /api/checkout',
      rootService: 'shop',
      services: ['payments', 'shop'],
      startTimeMs: 2000,
      durationMs: 2400,
      spanCount: 2,
      errorCount: 1,
    })
  })

  it('filters by service (any span), operation substring, errors, duration, time and limit', async () => {
    const storage = await seeded()
    const ids = async (f: Parameters<MemoryStorage['queryTraces']>[0]) => (await storage.queryTraces(f)).map((t) => t.traceId)
    expect(await ids({ service: 'payments' })).toEqual([T(2)])
    expect(await ids({ operation: 'render' })).toEqual([T(1)])
    expect(await ids({ hasError: true })).toEqual([T(2)])
    expect(await ids({ hasError: false })).toEqual([T(3), T(1)])
    expect(await ids({ minDurationMs: 1000 })).toEqual([T(2)])
    expect(await ids({ fromMs: 1500, toMs: 2500 })).toEqual([T(2)])
    expect(await ids({ limit: 1 })).toEqual([T(3)])
  })

  it('treats a span whose parent has not arrived yet as the root', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([span({ traceId: T(9), parentSpanId: 'f'.repeat(16), name: 'late child' })])
    expect((await storage.queryTraces())[0].rootName).toBe('late child')
  })
})

describe('MemoryStorage.getTrace / getOperationStats / getServices', () => {
  it('returns trace spans in start order', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([span({ traceId: T(1), name: 'b', startTimeMs: 20 }), span({ traceId: T(1), name: 'a', startTimeMs: 10 })])
    expect((await storage.getTrace(T(1))).map((s) => s.name)).toEqual(['a', 'b'])
    expect(await storage.getTrace(T(2))).toEqual([])
  })

  it('puts a parent before its children when they start in the same millisecond', async () => {
    const storage = new MemoryStorage()
    const root = span({ traceId: T(1), name: 'root', startTimeMs: 5 })
    const child = span({ traceId: T(1), name: 'child', parentSpanId: root.spanId, startTimeMs: 5 })
    const grandchild = span({ traceId: T(1), name: 'grandchild', parentSpanId: child.spanId, startTimeMs: 5 })
    // Exporters deliver children first (they end first).
    await storage.insertSpans([grandchild, child, root])
    expect((await storage.getTrace(T(1))).map((s) => s.name)).toEqual(['root', 'child', 'grandchild'])
  })

  it('aggregates per service + operation with error rate and percentiles, slowest p95 first', async () => {
    const storage = new MemoryStorage()
    const payments = Array.from({ length: 10 }, (_, i) =>
      span({ traceId: T(i), name: 'chargePayment', service: 'payments', durationMs: (i + 1) * 100, status: i < 3 ? 'error' : 'ok' }),
    )
    await storage.insertSpans([...payments, span({ traceId: T(50), name: 'fast', durationMs: 1 })])
    const stats = await storage.getOperationStats()
    expect(stats.map((s) => s.operation)).toEqual(['chargePayment', 'fast'])
    expect(stats[0]).toEqual({
      service: 'payments',
      operation: 'chargePayment',
      count: 10,
      errorCount: 3,
      errorRate: 0.3,
      avgMs: 550,
      p50Ms: 500,
      p95Ms: 1000,
      p99Ms: 1000,
      maxMs: 1000,
    })
    expect(await storage.getOperationStats({ service: 'shop' })).toHaveLength(1)
  })

  it('lists services with their versions', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([
      span({ traceId: T(1), service: 'shop', serviceVersion: 'v1', startTimeMs: 10 }),
      span({ traceId: T(2), service: 'shop', serviceVersion: 'v2', startTimeMs: 30 }),
      span({ traceId: T(3), service: 'shop-browser', serviceVersion: null }),
    ])
    expect(await storage.getServices()).toEqual([
      { name: 'shop', versions: ['v1', 'v2'], spanCount: 2, lastSeenMs: 30 },
      { name: 'shop-browser', versions: [], spanCount: 1, lastSeenMs: 1000 },
    ])
  })
})

describe('MemoryStorage eviction', () => {
  it('drops the oldest spans past maxSpans and forgets empty traces', async () => {
    const storage = new MemoryStorage({ maxSpans: 3 })
    await storage.insertSpans([span({ traceId: T(1) }), span({ traceId: T(2) }), span({ traceId: T(2) }), span({ traceId: T(3) })])
    expect(await storage.count()).toBe(3)
    expect(await storage.getTrace(T(1))).toEqual([])
    expect((await storage.queryTraces()).map((t) => t.traceId).sort()).toEqual([T(2), T(3)])
  })
})
