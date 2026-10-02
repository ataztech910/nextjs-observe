import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector, type NormalizedSpan } from '../src/collector/index.js'
import { createAgentQueries } from '../src/debug/queries.js'

const NOW = 1_800_000_000_000
let seq = 0

function request(name: string, startTimeMs: number, durationMs: number, extra: { instance?: string; version?: string; kind?: NormalizedSpan['kind'] } = {}): NormalizedSpan {
  seq++
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name,
    kind: extra.kind ?? 'server',
    service: 'shop',
    serviceVersion: extra.version ?? 'v1',
    scope: 'next.js',
    startTimeMs,
    durationMs,
    status: 'unset',
    statusMessage: null,
    attributes: { 'next.span_type': 'BaseServer.handleRequest' },
    resource: { 'service.name': 'shop', ...(extra.instance ? { 'service.instance.id': extra.instance } : {}) },
    events: [],
  }
}

describe('MemoryStorage.isColdStart', () => {
  it('marks the first server span of each route per process instance', async () => {
    const storage = new MemoryStorage()
    const a1 = request('GET /a', NOW, 500, { instance: 'p1' })
    const a2 = request('GET /a', NOW + 1000, 15, { instance: 'p1' })
    const b1 = request('GET /b', NOW + 2000, 400, { instance: 'p1' })
    const a1OtherProcess = request('GET /a', NOW + 3000, 450, { instance: 'p2' })
    await storage.insertSpans([a1, a2, b1, a1OtherProcess])
    expect([a1, a2, b1, a1OtherProcess].map((s) => storage.isColdStart(s))).toEqual([true, false, true, true])
  })

  it('takes the earliest request when batches arrive out of order', async () => {
    const storage = new MemoryStorage()
    const later = request('GET /a', NOW + 1000, 15, { instance: 'p1' })
    const earlier = request('GET /a', NOW, 500, { instance: 'p1' })
    await storage.insertSpans([later])
    await storage.insertSpans([earlier])
    expect([storage.isColdStart(earlier), storage.isColdStart(later)]).toEqual([true, false])
  })

  it('never marks spans without service.instance.id (other OTel sources, old next-observe) or non-server spans', async () => {
    const storage = new MemoryStorage()
    const noInstance = request('GET /a', NOW, 500)
    const internal = request('chargePayment', NOW, 500, { instance: 'p1', kind: 'internal' })
    await storage.insertSpans([noInstance, internal])
    expect([storage.isColdStart(noInstance), storage.isColdStart(internal)]).toEqual([false, false])
  })

  it('keeps the mark after eviction, so the next request never becomes "cold"', async () => {
    const storage = new MemoryStorage({ maxSpans: 1 })
    const first = request('GET /a', NOW, 500, { instance: 'p1' })
    const second = request('GET /a', NOW + 1000, 15, { instance: 'p1' })
    await storage.insertSpans([first])
    await storage.insertSpans([second])
    expect(storage.isColdStart(second)).toBe(false)
  })
})

// The real case from Porto Shop: `next dev` restarted for v2, the inventory route compiled on its first request
// (~580 ms vs ~15 ms), and with ~18 requests that one request was v2's p95 → a false "×5 regression".
async function restartScenario() {
  const storage = new MemoryStorage()
  const spans: NormalizedSpan[] = []
  for (const [version, instance, start, count] of [['v1', 'p1', NOW - 10 * 60_000, 30], ['v2', 'p2', NOW - 4 * 60_000, 18]] as const) {
    for (let i = 0; i < count; i++) spans.push(request('GET /api/inventory/[id]', start + i * 5000, i === 0 ? 580 : 15 + (i % 3), { instance, version }))
  }
  await storage.insertSpans(spans)
  return createAgentQueries(storage, { now: () => NOW })
}

describe('agent tools leave cold starts out of latency', () => {
  it('compare_versions: no false regression after a restart, and says what was left out', async () => {
    const result = await (await restartScenario()).compareVersions()
    expect(result.changes[0].p95Ratio).toBeLessThan(1.5)
    expect(result.changes[0].to.count).toBe(17)
    expect(result.note).toContain('2 cold-start request(s) left out')
  })

  it('get_operation_stats: p95 without the compile time', async () => {
    const result = await (await restartScenario()).getOperationStats()
    expect(result.operations[0]).toMatchObject({ operation: 'GET /api/inventory/[id]', count: 46 })
    expect(result.operations[0].p95Ms).toBeLessThan(20)
  })

  it('keeps an operation that only has cold requests, flagged', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([request('GET /once', NOW - 60_000, 900, { instance: 'p1' })])
    const result = await createAgentQueries(storage, { now: () => NOW }).getOperationStats()
    expect(result.operations).toEqual([expect.objectContaining({ operation: 'GET /once', count: 1, p95Ms: 900, onlyColdStarts: true })])
    expect(result.note).toBeUndefined()
  })

  it('get_trace marks the cold request', async () => {
    const storage = new MemoryStorage()
    const cold = request('GET /a', NOW - 60_000, 580, { instance: 'p1' })
    const warm = request('GET /a', NOW - 30_000, 15, { instance: 'p1' })
    await storage.insertSpans([cold, warm])
    const q = createAgentQueries(storage, { now: () => NOW })
    expect((await q.getTrace({ traceId: cold.traceId })).spans[0]).toMatchObject({ coldStart: true })
    expect((await q.getTrace({ traceId: warm.traceId })).spans[0]).not.toHaveProperty('coldStart')
  })
})

describe('anomaly detector input', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('does not see cold starts', async () => {
    const observed: string[] = []
    collector = await startCollector({ port: 0, uiDir: false, detector: { observe: (spans) => observed.push(...spans.map((s) => s.spanId)), check: () => [] } })
    const start = BigInt(NOW) * 1_000_000n
    const span = (id: string, offsetMs: number) => ({
      traceId: id.padStart(32, '0'),
      spanId: id.padStart(16, '0'),
      name: 'GET /a',
      kind: 2,
      startTimeUnixNano: String(start + BigInt(offsetMs) * 1_000_000n),
      endTimeUnixNano: String(start + BigInt(offsetMs + 20) * 1_000_000n),
    })
    const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'shop' } }, { key: 'service.instance.id', value: { stringValue: 'p1' } }] }
    const res = await fetch(`${collector.url}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{ resource, scopeSpans: [{ spans: [span('a1', 0), span('a2', 1000)] }] }] }),
    })
    expect(res.status).toBe(200)
    expect(observed).toEqual(['a2'.padStart(16, '0')])
  })
})
