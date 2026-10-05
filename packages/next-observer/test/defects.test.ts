import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector, type NormalizedSpan } from '../src/collector/index.js'
import { computeDefects, messageShape, type Defect } from '../src/collector/defects.js'
import { questionFor } from '../ui/src/lib/defects.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const MIN = 60_000
let seq = 0

function span(name: string, agoMs: number, extra: Partial<NormalizedSpan> & { message?: string; type?: string } = {}): NormalizedSpan {
  seq++
  const { message, type, ...rest } = extra
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name,
    kind: 'internal',
    service: 'shop',
    serviceVersion: 'v1',
    scope: 'next-observe',
    startTimeMs: NOW - agoMs,
    durationMs: 10,
    status: 'error',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: message ? [{ name: 'exception', timeMs: NOW - agoMs, attributes: { 'exception.message': message, ...(type ? { 'exception.type': type } : {}) } }] : [],
    ...rest,
  }
}

/** A failed request as Next records it: route (server) → framework step → the function that threw. */
function failedRequest(agoMs: number, message: string, extra: { version?: string; route?: string; fn?: string } = {}): NormalizedSpan[] {
  const serviceVersion = extra.version ?? 'v1'
  const root = span(extra.route ?? 'GET /api/inventory/[id]', agoMs, { kind: 'server', serviceVersion, attributes: { 'next.span_type': 'BaseServer.handleRequest', 'http.status_code': 500 } })
  const step = span('executing api route (app) /api/inventory/[id]', agoMs, { traceId: root.traceId, parentSpanId: root.spanId, serviceVersion, attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' } })
  const fn = span(extra.fn ?? 'checkInventory', agoMs, { traceId: root.traceId, parentSpanId: step.spanId, serviceVersion, message })
  return [root, step, fn]
}

const opts = { nowMs: NOW, windowMs: 10 * MIN, buckets: 10, deployOrder: new Map([['shop', ['v1', 'v2']]]) }
const compute = (spans: NormalizedSpan[], extra: Partial<typeof opts> & { service?: string } = {}): Defect[] => computeDefects(spans, { ...opts, ...extra })

describe('messageShape', () => {
  it('replaces numbers and long hex ids, keeps the words', () => {
    expect(messageShape('Order 4127 not found')).toBe('Order <n> not found')
    expect(messageShape('trace 5e6c30c2e0689d3b failed after 3 retries')).toBe('trace <id> failed after <n> retries')
    expect(messageShape('Inventory service timeout: upstream not responding')).toBe('Inventory service timeout: upstream not responding')
  })
})

describe('computeDefects', () => {
  it('counts a failed request once, where the error originated, and lists the route as affected', () => {
    const defects = compute([...failedRequest(MIN, 'Inventory service timeout'), ...failedRequest(2 * MIN, 'Inventory service timeout')])
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatchObject({
      service: 'shop',
      operation: 'checkInventory',
      message: 'Inventory service timeout',
      count: 2,
      affected: [{ operation: 'GET /api/inventory/[id]', count: 2 }],
    })
    expect(defects[0].exampleTraceIds).toHaveLength(2)
  })

  it('a route that fails on its own is its own defect, with nothing "affected"', () => {
    const root = span('POST /api/checkout', MIN, { kind: 'server', statusMessage: 'Internal Server Error', attributes: { 'next.span_type': 'BaseServer.handleRequest' } })
    const step = span('executing api route (app) /api/checkout', MIN, { traceId: root.traceId, parentSpanId: root.spanId, attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' } })
    expect(compute([root, step])).toMatchObject([{ operation: 'POST /api/checkout', message: 'Internal Server Error', affected: [] }])
  })

  it('a parent is looked up within its own trace: equal span ids in two traces are unrelated', () => {
    const [root, step, fn] = failedRequest(MIN, 'timeout')
    // Another trace whose failed span happens to carry the id of the first trace's root.
    const stranger = span('sendEmail', MIN, { spanId: root.spanId, message: 'SMTP refused' })
    // The stranger comes first, so a lookup by span id alone would find it instead of the real root.
    const defects = compute([stranger, root, step, fn])
    expect(defects.map((d) => d.operation).sort()).toEqual(['checkInventory', 'sendEmail'])
    expect(defects.find((d) => d.operation === 'sendEmail')!.affected).toEqual([])
  })

  it('only framework spans failed → still reported rather than hidden', () => {
    const only = span('executing api route (app) /api/x', MIN, { attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' } })
    expect(compute([only])).toMatchObject([{ operation: 'executing api route (app) /api/x', message: '(no message)' }])
  })

  it('groups by message shape, shows the latest message and its exception type', () => {
    const defects = compute([
      span('loadOrder', 3 * MIN, { message: 'Order 4127 not found', type: 'NotFoundError' }),
      span('loadOrder', MIN, { message: 'Order 9 not found', type: 'NotFoundError' }),
      span('loadOrder', 2 * MIN, { message: 'Database connection refused' }),
    ])
    expect(defects.map((d) => [d.message, d.count, d.type])).toEqual([
      ['Order 9 not found', 2, 'NotFoundError'],
      ['Database connection refused', 1, null],
    ])
  })

  it('same message in different operations or services is different defects', () => {
    const defects = compute([span('a', MIN, { message: 'timeout' }), span('b', MIN, { message: 'timeout' }), span('a', MIN, { message: 'timeout', service: 'other' })])
    expect(defects).toHaveLength(3)
    expect(compute([span('a', MIN, { message: 'timeout' }), span('a', MIN, { message: 'timeout', service: 'other' })], { service: 'other' })).toMatchObject([{ service: 'other' }])
  })

  it('history beyond the window: first seen, versions in deploy order, not new', () => {
    const defects = compute([
      span('checkInventory', 50 * MIN, { message: 'timeout', serviceVersion: 'v1' }),
      span('checkInventory', 5 * MIN, { message: 'timeout', serviceVersion: 'v2' }),
      span('checkInventory', MIN, { message: 'timeout', serviceVersion: 'v2' }),
    ])
    expect(defects[0]).toMatchObject({ count: 2, firstSeenMs: NOW - 50 * MIN, lastSeenMs: NOW - MIN, firstSeenVersion: 'v1', versions: ['v1', 'v2'], isNew: false })
  })

  it('new: first seen in the latest version — and listed first even when rarer', () => {
    const old = [1, 2, 3, 4].map((m) => span('checkInventory', m * MIN, { message: 'timeout', serviceVersion: m > 2 ? 'v1' : 'v2' }))
    const fresh = span('applyCoupon', MIN, { message: 'coupon is undefined', serviceVersion: 'v2' })
    const defects = compute([...old, fresh])
    expect(defects.map((d) => [d.operation, d.isNew])).toEqual([
      ['applyCoupon', true],
      ['checkInventory', false],
    ])
    // With a single version deployed nothing can be "new in" it.
    expect(compute([fresh], { deployOrder: new Map([['shop', ['v2']]]) })[0].isNew).toBe(false)
  })

  it('a defect that stopped happening is not listed', () => {
    expect(compute([span('checkInventory', 50 * MIN, { message: 'timeout' })])).toEqual([])
  })

  it('series: occurrences per bucket of the window, the last one including now', () => {
    const d = compute([span('a', 9.5 * MIN, { message: 'x' }), span('a', 0, { message: 'x' }), span('a', 20_000, { message: 'x' })])[0]
    expect(d.series).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2])
  })

  it('more frequent first among equally old defects; at most 3 examples, newest first', () => {
    const many = [5, 4, 3, 2, 1].map((m) => span('a', m * MIN, { message: 'often' }))
    const defects = compute([span('b', MIN, { message: 'rare' }), ...many])
    expect(defects.map((d) => d.message)).toEqual(['often', 'rare'])
    expect(defects[0].exampleTraceIds).toEqual([many[4].traceId, many[3].traceId, many[2].traceId])
  })

  it('on the workshop shop: one defect — the inventory timeout, seen in both versions', async () => {
    const storage = await shopStorage()
    const failed = await storage.querySpans({ status: 'error', limit: Number.MAX_SAFE_INTEGER })
    const deployOrder = new Map((await storage.getServices()).map((s) => [s.name, s.versions]))
    const defects = computeDefects(failed, { nowMs: NOW, windowMs: 15 * MIN, buckets: 30, deployOrder })
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatchObject({ operation: 'inventory.check', message: 'Inventory service timeout: upstream not responding', isNew: false, versions: ['v1', 'v2'], affected: [{ operation: 'GET /api/inventory/[id]' }] })
  })
})

describe('GET /api/defects', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('serves defects for the window; rejects a window out of range', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([...failedRequest(MIN, 'Inventory service timeout'), span('fine', MIN, { status: 'unset' })])
    collector = await startCollector({ port: 0, storage, uiDir: false })
    const defects = (await (await fetch(`${collector.url}/api/defects?windowMs=${5 * MIN}&toMs=${NOW}`)).json()) as Defect[]
    expect(defects).toMatchObject([{ operation: 'checkInventory', count: 1 }])
    expect((await fetch(`${collector.url}/api/defects?windowMs=5`)).status).toBe(400)
  })
})

describe('questionFor', () => {
  const base = { operation: 'checkInventory', message: 'Inventory service timeout', isNew: false, firstSeenVersion: 'v1', versions: ['v1'], affected: [] }

  it('states the operation and the message, and asks why and whether it is new', () => {
    expect(questionFor(base)).toBe('checkInventory fails with "Inventory service timeout". Why does it fail, and is it new?')
  })

  it('adds the failing route and what is known about its history', () => {
    expect(questionFor({ ...base, versions: ['v1', 'v2'], affected: [{ operation: 'GET /api/inventory/[id]' }, { operation: 'GET /product/[id]' }] })).toBe(
      'checkInventory fails with "Inventory service timeout" (requests to GET /api/inventory/[id] fail because of it). It is seen in v1 and v2. Why does it fail, and is it new?',
    )
    expect(questionFor({ ...base, isNew: true, firstSeenVersion: 'v2', versions: ['v2'] })).toBe('checkInventory fails with "Inventory service timeout". It first appeared in v2. Why does it fail, and is it new?')
  })
})
