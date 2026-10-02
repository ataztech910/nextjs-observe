import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryStorage } from '../src/collector/memory-storage.js'
import { createAgentQueries, type AgentQueries } from '../src/debug/queries.js'
import { NOW, shopStorage } from './fixtures/shop.js'

let q: AgentQueries

beforeAll(async () => {
  q = createAgentQueries(await shopStorage(), { now: () => NOW })
})

describe('getServices', () => {
  it('lists versions in deploy order and data freshness', async () => {
    expect(await q.getServices()).toEqual({ services: [{ name: 'shop', versions: ['v0', 'v1', 'v2'], spans: expect.any(Number), lastSpanSecondsAgo: expect.any(Number) }] })
    const [shop] = (await q.getServices()).services
    expect(shop.lastSpanSecondsAgo).toBeLessThan(3 * 60)
  })
})

describe('getOperationStats', () => {
  it('ranks the slowest operation first, within the time window', async () => {
    const { operations } = await q.getOperationStats()
    expect(operations[0]).toMatchObject({ operation: 'POST /api/checkout' })
    expect(operations[1]).toMatchObject({ operation: 'chargePayment', count: 60, errorRate: 0 })
    expect(operations[1].p95Ms).toBeGreaterThan(2000)
  })

  it('matches names case-insensitively', async () => {
    const { operations, ...rest } = await q.getOperationStats({ operation: 'payment' })
    expect(rest).toEqual({})
    expect(operations.map((o) => o.operation)).toEqual(['chargePayment'])
  })

  it('falls back to all operations with a note instead of an empty result', async () => {
    const result = await q.getOperationStats({ operation: 'refund' })
    expect(result.note).toContain('nothing matches "refund"')
    expect(result.operations.length).toBeGreaterThan(3)
  })
})

describe('compareVersions', () => {
  it('names the deployment that made chargePayment ~8x slower', async () => {
    const { changes } = await q.compareVersions({ sinceMinutes: 15 })
    const payment = changes.find((c) => c.operation === 'chargePayment')!
    expect(changes[0].operation).toMatch(/chargePayment|POST \/api\/checkout/)
    expect(payment.from).toMatchObject({ version: 'v1', count: 30 })
    expect(payment.to).toMatchObject({ version: 'v2', count: 30 })
    expect(payment.p95Ratio).toBeGreaterThan(7)
    expect(payment.errorRateDelta).toBe(0)
  })

  it('uses deploy order, not alphabetical order of version names', async () => {
    const storage = new MemoryStorage()
    const base = { traceId: 'a'.repeat(32), parentSpanId: null, kind: 'server' as const, service: 's', scope: null, status: 'unset' as const, statusMessage: null, attributes: {}, resource: {}, events: [] }
    await storage.insertSpans([
      { ...base, spanId: '1'.padStart(16, '0'), name: 'op', serviceVersion: 'f00d', startTimeMs: NOW - 60_000, durationMs: 10 }, // deployed first
      { ...base, spanId: '2'.padStart(16, '0'), name: 'op', serviceVersion: 'a1b2', startTimeMs: NOW - 30_000, durationMs: 50 }, // deployed second
    ])
    const { changes } = await createAgentQueries(storage, { now: () => NOW }).compareVersions()
    expect(changes[0]).toMatchObject({ from: { version: 'f00d' }, to: { version: 'a1b2' }, p95Ratio: 5 })
  })

  it('says so when there is only one version', async () => {
    const { note, changes } = await q.compareVersions({ sinceMinutes: 5 })
    expect(changes).toEqual([])
    expect(note).toContain('only one version')
  })
})

describe('getErrors', () => {
  it('finds the failing operation with its rate, message and example traces', async () => {
    const { errors } = await q.getErrors()
    const check = errors.find((e) => e.operation === 'inventory.check')!
    expect(check).toMatchObject({ errors: 18, errorRate: 0.3, topMessages: [{ message: 'Inventory service timeout: upstream not responding', count: 18 }] })
    expect(check.exampleTraceIds).toHaveLength(3)
  })

  it('for a real but healthy operation: says so, and still shows what is failing elsewhere', async () => {
    // "500s on product pages" → the agent asks for "product"; GET /api/products is healthy, inventory.check fails on those pages.
    const result = await q.getErrors({ operation: 'product' })
    expect(result.note).toBe('"product" has no errors in this window; showing failing operations elsewhere')
    expect(result.errors.map((e) => e.operation)).toContain('inventory.check')
  })

  it('falls back to all errors only when the name matches nothing', async () => {
    const result = await q.getErrors({ operation: 'refund' })
    expect(result.note).toContain('nothing matches "refund"')
    expect(result.errors[0].operation).toMatch(/inventory|GET \/api\/inventory/)
  })

  it('reports an empty window explicitly', async () => {
    expect(await q.getErrors({ sinceMinutes: 1 })).toEqual({ note: 'no errors in this window', errors: [] })
  })
})

describe('searchTraces', () => {
  it('finds slow traces and error traces', async () => {
    const slow = await q.searchTraces({ minDurationMs: 1000, limit: 50 })
    expect(slow.traces.length).toBeGreaterThan(0)
    expect(slow.traces.every((t) => t.root === 'POST /api/checkout' && t.durationMs >= 1000)).toBe(true)
    const failing = await q.searchTraces({ hasError: true, limit: 3 })
    expect(failing.traces).toHaveLength(3)
    // Error spans of the whole trace, Next's wrapper included (get_trace hides it) — the summary is shared with the UI.
    expect(failing.traces[0]).toMatchObject({ root: 'GET /api/inventory/[id]', errors: 3 })
  })
})

describe('service filter', () => {
  // A specialist without get_services guessed service "checkout" in a real run and got nothing back.
  it('an unknown service falls back to all services with the real names, in every filtering tool', async () => {
    const note = 'no service "checkout" (services: shop), showing all services instead'
    const versions = await q.compareVersions({ service: 'checkout', operation: 'chargePayment' })
    expect(versions.note).toBe(note)
    expect(versions.changes[0]).toMatchObject({ operation: 'chargePayment', from: { version: 'v1' }, to: { version: 'v2' } })

    const stats = await q.getOperationStats({ service: 'checkout' })
    expect(stats.note).toBe(note)
    expect(stats.operations.length).toBeGreaterThan(0)

    const errors = await q.getErrors({ service: 'checkout' })
    expect(errors.note).toBe(note)
    expect(errors.errors.length).toBeGreaterThan(0)

    const traces = await q.searchTraces({ service: 'checkout', operation: 'nope' })
    expect(traces.note).toBe(`${note}; nothing matches "nope", showing all operations instead`)
    expect(traces.traces.length).toBeGreaterThan(0)
  })

  it('matches service names case-insensitively without a note', async () => {
    const stats = await q.getOperationStats({ service: 'SHOP' })
    expect(stats.note).toBeUndefined()
    expect(stats.operations.every((o) => o.service === 'shop')).toBe(true)
  })
})

describe('getTrace', () => {
  it('flags the N+1: 5 identical db.query siblings, with self time on the parent', async () => {
    const [catalogTrace] = (await q.searchTraces({ operation: 'GET /api/products', limit: 1 })).traces
    const trace = await q.getTrace({ traceId: catalogTrace.traceId })
    expect(trace.repeated).toEqual([{ parent: 'GET /api/products', operation: 'db.query', count: 5, totalMs: 90 }])
    // 120 ms = 98 in children + 20 inside Next's hidden route span + 2 of its own.
    expect(trace.spans[0]).toMatchObject({ depth: 0, name: 'GET /api/products', durationMs: 120, selfMs: 2, nextInternalMs: 20 })
    expect(trace.spans.filter((s) => s.name === 'db.query')).toHaveLength(5)
  })

  it('shows the error message and code location for root cause', async () => {
    const [failing] = (await q.searchTraces({ hasError: true, limit: 1 })).traces
    const trace = await q.getTrace({ traceId: failing.traceId })
    expect(trace.spans[1]).toMatchObject({
      depth: 1,
      name: 'inventory.check',
      error: 'Inventory service timeout: upstream not responding',
      attributes: { 'code.filepath': 'app/api/inventory/[id]/route.ts' },
    })
  })

  it('handles unknown traces and caps long ones', async () => {
    expect(await q.getTrace({ traceId: '0'.repeat(32) })).toMatchObject({ note: expect.stringContaining('not found'), spans: [] })
    const [catalogTrace] = (await q.searchTraces({ operation: 'products', limit: 1 })).traces
    const capped = await q.getTrace({ traceId: catalogTrace.traceId, maxSpans: 3 })
    expect(capped.spans).toHaveLength(3)
    expect(capped.note).toBe('showing 3 of 7 spans')
  })
})

describe('Next.js internal spans', () => {
  it('are left out of stats, version comparison and errors — one problem is reported once', async () => {
    const internal = (name: string) => name.startsWith('executing api route')
    expect((await q.getOperationStats({ limit: 50 })).operations.some((o) => internal(o.operation))).toBe(false)
    const changes = (await q.compareVersions()).changes.map((c) => c.operation)
    expect(changes.slice(0, 2)).toEqual(['chargePayment', 'POST /api/checkout'])
    expect(changes.some(internal)).toBe(false)
    expect((await q.getErrors()).errors.map((e) => e.operation).sort()).toEqual(['GET /api/inventory/[id]', 'inventory.check'])
  })

  it('get_trace attaches their children to the nearest visible ancestor and says how many were hidden', async () => {
    const [checkoutTrace] = (await q.searchTraces({ operation: 'POST /api/checkout', minDurationMs: 1000, limit: 1 })).traces
    const trace = await q.getTrace({ traceId: checkoutTrace.traceId })
    expect((trace as { nextInternalSpansHidden?: number }).nextInternalSpansHidden).toBe(1)
    expect(trace.spans.map((s) => [s.depth, s.name])).toEqual([[0, 'POST /api/checkout'], [1, 'chargePayment']])
    // The hidden route span's own 10 ms is Next's, not the handler's: it must not inflate selfMs.
    expect(trace.spans[0]).toMatchObject({ selfMs: 10, nextInternalMs: 10 })
    expect(trace.spans[1]).not.toHaveProperty('nextInternalMs')
  })

  it('a trace made only of framework spans is shown as is', async () => {
    const storage = new MemoryStorage()
    const base = { traceId: 'f'.repeat(32), kind: 'internal' as const, service: 'shop', serviceVersion: 'v1', scope: 'next.js', startTimeMs: NOW - 1000, durationMs: 5, status: 'unset' as const, statusMessage: null, resource: {}, events: [], attributes: { 'next.span_type': 'NextNodeServer.startResponse' } }
    await storage.insertSpans([{ ...base, spanId: 'a'.repeat(16), parentSpanId: null, name: 'start response' }])
    const trace = await createAgentQueries(storage, { now: () => NOW }).getTrace({ traceId: base.traceId })
    expect(trace.spans.map((s) => s.name)).toEqual(['start response'])
    expect((trace as { nextInternalSpansHidden?: number }).nextInternalSpansHidden).toBeUndefined()
  })
})

describe('token budget', () => {
  it('keeps every tool output small even with hundreds of traces', async () => {
    const [t] = (await q.searchTraces({ limit: 1 })).traces
    const outputs = {
      getServices: await q.getServices(),
      getOperationStats: await q.getOperationStats(),
      compareVersions: await q.compareVersions(),
      getErrors: await q.getErrors(),
      searchTraces: await q.searchTraces(),
      getTrace: await q.getTrace({ traceId: t.traceId }),
    }
    for (const [name, output] of Object.entries(outputs)) expect(JSON.stringify(output).length, name).toBeLessThan(4000)
  })
})
