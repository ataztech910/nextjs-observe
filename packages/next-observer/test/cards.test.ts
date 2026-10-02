import { beforeAll, describe, expect, it } from 'vitest'
import { cardsFromResult, createChatHandler } from '../src/agents/index.js'
import type { ChatEvent, EvidenceCard } from '../src/collector/index.js'
import { createAgentQueries, type AgentQueries } from '../src/debug/queries.js'
import { NOW, shopStorage } from './fixtures/shop.js'

let q: AgentQueries
beforeAll(async () => {
  q = createAgentQueries(await shopStorage(), { now: () => NOW })
})

const byKind = <K extends EvidenceCard['kind']>(cards: EvidenceCard[], kind: K) => cards.filter((c): c is Extract<EvidenceCard, { kind: K }> => c.kind === kind)

describe('cardsFromResult', () => {
  it('compare_versions → a regression card for chargePayment v1 → v2, nothing below threshold', async () => {
    const cards = cardsFromResult('compare_versions', {}, await q.compareVersions())
    const payment = byKind(cards, 'regression').find((c) => c.operation === 'chargePayment')!
    expect(payment).toMatchObject({ from: { version: 'v1' }, to: { version: 'v2' }, errorRateDelta: 0 })
    expect(payment.p95Ratio).toBeGreaterThan(7)
    expect(cards.every((c) => c.kind === 'regression' && (c.p95Ratio ?? 0) >= 1.5)).toBe(true)
    // A window holding only v2 still compares with v1's last window of traffic.
    expect(byKind(cardsFromResult('compare_versions', {}, await q.compareVersions({ sinceMinutes: 5 })), 'regression').map((c) => c.operation)).toContain('chargePayment')
  })

  it('get_errors → an errors card with the exact message and example traces; tiny error rates are ignored', async () => {
    const cards = byKind(cardsFromResult('get_errors', {}, await q.getErrors()), 'errors')
    expect(cards.find((c) => c.operation === 'inventory.check')).toMatchObject({
      errorRate: 0.3,
      errors: 18,
      message: 'Inventory service timeout: upstream not responding',
      traceIds: expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{32}$/)]),
    })
    const low = { errors: [{ service: 's', operation: 'op', errors: 1, errorRate: 0.01, topMessages: [{ message: 'm', count: 1 }], exampleTraceIds: [] }] }
    expect(cardsFromResult('get_errors', {}, low)).toEqual([])
  })

  it('get_trace → an N+1 card for the catalog, a hotspot card with the code file for slow checkout', async () => {
    const [catalog] = (await q.searchTraces({ operation: 'GET /api/products', limit: 1 })).traces
    expect(cardsFromResult('get_trace', {}, await q.getTrace({ traceId: catalog.traceId }))).toEqual([
      { kind: 'n-plus-one', traceId: catalog.traceId, parent: 'GET /api/products', operation: 'db.query', count: 5, totalMs: 90 },
    ])
    const [slow] = (await q.searchTraces({ minDurationMs: 2000, limit: 1 })).traces
    const hotspot = byKind(cardsFromResult('get_trace', {}, await q.getTrace({ traceId: slow.traceId })), 'hotspot')
    expect(hotspot).toEqual([{ kind: 'hotspot', traceId: slow.traceId, operation: 'chargePayment', selfMs: expect.any(Number), traceMs: expect.any(Number), codeFile: 'lib/payment.ts' }])
    expect(hotspot[0].selfMs / hotspot[0].traceMs).toBeGreaterThan(0.9)
    expect(cardsFromResult('get_trace', {}, await q.getTrace({ traceId: '0'.repeat(32) }))).toEqual([])
  })

  it('get_services → a silent-service card only when a service stopped sending', async () => {
    expect(cardsFromResult('get_services', {}, await q.getServices())).toEqual([])
    const later = createAgentQueries(await shopStorage(), { now: () => NOW + 10 * 60_000 })
    expect(cardsFromResult('get_services', {}, await later.getServices())).toEqual([{ kind: 'silent', service: 'shop', lastSpanSecondsAgo: expect.any(Number) }])
  })

  it('search_traces → a trace list card labelled with the filters, at most 5 traces', async () => {
    const [card] = cardsFromResult('search_traces', { hasError: true, operation: 'inventory' }, await q.searchTraces({ hasError: true, operation: 'inventory', limit: 10 }))
    expect(card).toMatchObject({ kind: 'traces', label: 'Traces · hasError=true, operation=inventory' })
    expect(card.kind === 'traces' && card.traces.length).toBe(5)
  })

  it('ignores tools without cards', () => {
    expect(cardsFromResult('get_operation_stats', {}, { operations: [] })).toEqual([])
    expect(cardsFromResult('latency_agent', {}, { result: 'x' })).toEqual([])
  })
})

describe('chat turn with cards (mock model)', () => {
  it('streams regression, errors and trace-list cards, each finding once, before the report', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW } })
    const events: ChatEvent[] = []
    await handler.handle({ question: 'Checkout is slow and product pages fail' }, (e) => events.push(e))
    const cards = events.flatMap((e) => (e.type === 'card' ? [e.card] : []))
    expect(byKind(cards, 'regression').map((c) => c.operation)).toContain('chargePayment')
    expect(byKind(cards, 'errors').map((c) => c.operation)).toContain('inventory.check')
    expect(byKind(cards, 'traces').length).toBeGreaterThan(0)
    const keys = cards.map((c) => JSON.stringify(c))
    expect(new Set(keys).size).toBe(keys.length)
    expect(events.findIndex((e) => e.type === 'card')).toBeLessThan(events.findIndex((e) => e.type === 'report'))
  })
})

describe('regression card on error rate', () => {
  const change = (errorRateDelta: number, errorRateChangeSignificant: boolean) => ({
    service: 'shop',
    operation: 'GET /api/inventory/[id]',
    from: { version: 'v1', count: 32, p50Ms: 15, p95Ms: 115, errorRate: 0.29 },
    to: { version: 'v2', count: 18, p50Ms: 16, p95Ms: 140, errorRate: 0.29 + errorRateDelta },
    p95Ratio: 1.2,
    errorRateDelta,
    errorRateChangeSignificant,
  })

  it('needs the change to be significant, not just ≥ 0.1', () => {
    expect(cardsFromResult('compare_versions', {}, { changes: [change(0.15, false)] })).toEqual([])
    expect(cardsFromResult('compare_versions', {}, { changes: [change(0.15, true)] })).toHaveLength(1)
  })
})

describe('regression card on latency', () => {
  const change = (fromMs: number, toMs: number) => ({
    service: 'shop',
    operation: 'op',
    from: { version: 'v1', count: 97, p50Ms: fromMs, p95Ms: fromMs, errorRate: 0 },
    to: { version: 'v2', count: 63, p50Ms: toMs, p95Ms: toMs, errorRate: 0 },
    p95Ratio: Math.round((toMs / fromMs) * 10) / 10,
    errorRateDelta: 0,
    errorRateChangeSignificant: false,
  })

  it('needs ×1.5 and at least +50 ms: the real chargePayment regression yes, a fast call\'s 22 → 49 ms blip no', () => {
    expect(cardsFromResult('compare_versions', {}, { changes: [change(233, 2487)] })).toHaveLength(1)
    expect(cardsFromResult('compare_versions', {}, { changes: [change(21.9, 49)] })).toEqual([])
    expect(cardsFromResult('compare_versions', {}, { changes: [change(100, 140)] })).toEqual([])
    // +100 ms on a 1 s operation is only ×1.1 — the ratio is the main criterion.
    expect(cardsFromResult('compare_versions', {}, { changes: [change(1000, 1100)] })).toEqual([])
  })
})
