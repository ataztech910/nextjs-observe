import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector, type NormalizedSpan } from '../src/collector/index.js'
import { computeDefects, messageShape, type Defect, type DefectsOptions } from '../src/collector/defects.js'
import { describeDefect, questionFor, sameRoute } from '../ui/src/lib/defects.js'
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

const opts: DefectsOptions = { nowMs: NOW, windowMs: 10 * MIN, buckets: 10, deployOrder: new Map([['shop', ['v1', 'v2']]]), historyComplete: true }
const compute = (spans: NormalizedSpan[], extra: Partial<DefectsOptions> = {}): Defect[] => computeDefects(spans, { ...opts, ...extra })

describe('messageShape', () => {
  it('replaces numbers and long hex ids, keeps the words', () => {
    expect(messageShape('Order 4127 not found')).toBe('Order <n> not found')
    expect(messageShape('trace 5e6c30c2e0689d3b failed after 3 retries')).toBe('trace <id> failed after <n> retries')
    expect(messageShape('Inventory service timeout: upstream not responding')).toBe('Inventory service timeout: upstream not responding')
  })

  it('a status code inside the text is part of what the message says: 404 and 500 stay different', () => {
    expect(messageShape('Request failed with status code 404')).toBe('Request failed with status code 404')
    expect(messageShape('Request failed with status code 500')).toBe('Request failed with status code 500')
    expect(messageShape('HTTP 503 from upstream after 3 retries, order 4127')).toBe('HTTP 503 from upstream after <n> retries, order <n>')
    expect(messageShape('status 404 then HTTP 500')).toBe('status 404 then HTTP 500')
    // Not a status: a number that merely follows other words, or more than three digits.
    expect(messageShape('Order 404 not found')).toBe('Order <n> not found')
    expect(messageShape('status code 40412')).toBe('status code <n>')
  })

  it('a UUID is one id, whatever letters its short groups contain', () => {
    expect(messageShape('User 550e8400-e29b-41d4-a716-446655440000 not found')).toBe('User <id> not found')
    expect(messageShape('User 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found')).toBe('User <id> not found')
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
    // …and an unrelated failure in another trace (even an old one) does not hide it.
    const elsewhere = span('sendEmail', 50 * MIN, { message: 'SMTP refused' })
    expect(compute([only, elsewhere]).map((d) => d.operation)).toEqual(['executing api route (app) /api/x'])
  })

  it('the affected request keeps its own service when the failure crosses services', () => {
    const fetch = span('GET', MIN, { service: 'shop-browser', kind: 'client' })
    const server = span('GET /api/inventory/[id]', MIN, { traceId: fetch.traceId, parentSpanId: fetch.spanId, kind: 'server' })
    const fn = span('checkInventory', MIN, { traceId: fetch.traceId, parentSpanId: server.spanId, message: 'timeout' })
    expect(compute([fetch, server, fn])[0].affected).toEqual([{ service: 'shop-browser', operation: 'GET', spanName: 'GET', count: 1 }])
  })

  describe('what happened in the browser', () => {
    const browser = (name: string, agoMs: number, extra: Parameters<typeof span>[2] = {}) =>
      span(name, agoMs, { service: 'shop-browser', resource: { 'telemetry.sdk.language': 'webjs' }, ...extra })
    const caught = (kind: string, agoMs: number, message: string, page: string) => browser(kind, agoMs, { message, attributes: { 'observe.kind': 'browser-error', 'url.path': page } })

    it('an error the APM agent caught: source, category, and the pages it happened on (one defect across pages)', () => {
      const defects = compute([
        // The rarer page comes first in time: the list is ordered by how often, not by arrival.
        caught('uncaught error', 3 * MIN, "Cannot read properties of undefined (reading 'price')", '/product/7'),
        caught('uncaught error', 2 * MIN, "Cannot read properties of undefined (reading 'price')", '/product/3'),
        caught('uncaught error', MIN, "Cannot read properties of undefined (reading 'price')", '/product/3'),
      ])
      expect(defects).toHaveLength(1)
      expect(defects[0]).toMatchObject({
        operation: 'uncaught error',
        spanName: 'uncaught error',
        source: 'browser',
        category: 'browser-error',
        count: 3,
        pages: [
          { path: '/product/3', count: 2 },
          { path: '/product/7', count: 1 },
        ],
      })
    })

    it('failing requests are told apart by their path, and ids in the path do not split one defect', () => {
      const request = (url: string, code: number, agoMs: number) => browser('GET', agoMs, { kind: 'client', attributes: { 'url.full': url, 'http.status_code': code } })
      const defects = compute([
        request('http://localhost:3000/api/inventory/1', 404, 3 * MIN),
        request('http://localhost:3000/api/inventory/2', 404, 2 * MIN),
        request('http://localhost:3000/api/coupons', 404, MIN),
      ])
      expect(defects.map((d) => [d.operation, d.spanName, d.category, d.count, d.message])).toEqual([
        ['GET /api/inventory/:id', 'GET', 'request', 2, 'HTTP 404'],
        ['GET /api/coupons', 'GET', 'request', 1, 'HTTP 404'],
      ])
    })

    it('the browser request that failed because of the server is listed by its path, not as "GET"', () => {
      const fetch = browser('GET', MIN, { kind: 'client', attributes: { 'url.full': 'http://localhost:3000/api/inventory/1', 'http.status_code': 500 } })
      const server = span('GET /api/inventory/[id]', MIN, { traceId: fetch.traceId, parentSpanId: fetch.spanId, kind: 'server' })
      const fn = span('checkInventory', MIN, { traceId: fetch.traceId, parentSpanId: server.spanId, message: 'timeout' })
      const [defect] = compute([fetch, server, fn])
      expect(defect).toMatchObject({ operation: 'checkInventory', source: 'server', category: 'code', pages: [] })
      expect(defect.affected).toEqual([{ service: 'shop-browser', operation: 'GET /api/inventory/:id', spanName: 'GET', count: 1 }])
    })

    it('the browser is recognised by the SDK in the resource; the service name decides only when the SDK does not say', () => {
      expect(compute([span('x', MIN, { message: 'm', resource: { 'telemetry.sdk.language': 'webjs' } })])[0].source).toBe('browser')
      expect(compute([span('x', MIN, { message: 'm', service: 'shop-browser' })])[0].source).toBe('browser')
      expect(compute([span('x', MIN, { message: 'm', resource: { 'telemetry.sdk.language': 'nodejs' } })])[0].source).toBe('server')
      // A Node service that merely has "browser" in its name is a server.
      expect(compute([span('x', MIN, { message: 'm', service: 'headless-browser', resource: { 'telemetry.sdk.language': 'nodejs' } })])[0].source).toBe('server')
    })

    it('a bare status is compared exactly: 404s and 500s on one route are two defects, each with its own count', () => {
      const request = (code: number, agoMs: number) => browser('GET', agoMs, { kind: 'client', attributes: { 'url.full': 'http://localhost:3000/api/inventory/1', 'http.status_code': code } })
      const defects = compute([request(404, 4 * MIN), request(404, 3 * MIN), request(500, MIN)])
      expect(defects.map((d) => [d.message, d.count]).sort()).toEqual([['HTTP 404', 2], ['HTTP 500', 1]])
    })

    it('pages are the APM agent’s browser errors only: a server span’s url.path is a request path, not a page', () => {
      const server = span('GET /api/orders/[id]', MIN, { kind: 'server', message: 'boom', attributes: { 'url.path': '/api/orders/17' } })
      expect(compute([server])[0]).toMatchObject({ category: 'code', pages: [] })
    })

    it('a client request and a span literally named like its label are different defects', () => {
      const request = browser('GET', MIN, { kind: 'client', attributes: { 'url.full': 'http://localhost:3000/api/x', 'http.status_code': 500 } })
      const code = browser('GET /api/x', MIN, { attributes: { 'http.status_code': 500 } })
      const defects = compute([request, code])
      expect(defects).toHaveLength(2)
      expect(defects.find((d) => d.category === 'request')).toMatchObject({ operation: 'GET /api/x', spanName: 'GET' })
      expect(defects.find((d) => d.category === 'code')).toMatchObject({ operation: 'GET /api/x', spanName: 'GET /api/x' })
    })

    it('after old spans were dropped a request is never called new: "some GET ran in v1" is no evidence about this path', () => {
      const asked: string[] = []
      const ranIn = (service: string, operation: string, version: string) => (asked.push(`${service}/${operation}@${version}`), true)
      const request = browser('GET', MIN, { kind: 'client', serviceVersion: 'v2', attributes: { 'url.full': 'http://localhost:3000/api/coupons', 'http.status_code': 404 } })
      const options = { historyComplete: false, ranIn, deployOrder: new Map([['shop-browser', ['v1', 'v2']]]) }
      expect(compute([request], options)[0].isNew).toBe(false)
      expect(asked).toEqual([])
      // With the whole history at hand it can be: nothing was dropped, so "first seen in v2" is a fact.
      expect(compute([request], { ...options, historyComplete: true })[0].isNew).toBe(true)
      // The same for a browser error: its span is named after the kind ("uncaught error"), and some uncaught error
      // happened in every version.
      const thrown = caught('uncaught error', MIN, 'x is undefined', '/cart')
      thrown.serviceVersion = 'v2'
      expect(compute([thrown], options)[0].isNew).toBe(false)
      expect(asked).toEqual([])
      // A piece of code is still checked by its name.
      const code = browser('applyCoupon', MIN, { message: 'coupon is undefined', serviceVersion: 'v2' })
      expect(compute([code], options)[0].isNew).toBe(true)
      expect(asked).toEqual(['shop-browser/applyCoupon@v1'])
    })

    it('what a defect is comes from its most recent occurrence, like its message', () => {
      // An older span of the same name without the APM agent's marker, then the marked ones.
      const old = browser('uncaught error', 30 * MIN, { message: 'x is undefined' })
      const fresh = caught('uncaught error', MIN, 'x is undefined', '/cart')
      expect(compute([old, fresh])[0]).toMatchObject({ category: 'browser-error', count: 1, pages: [{ path: '/cart', count: 1 }] })
    })

    it('affected rows keep a request and a span literally named like its label apart', () => {
      const viaRequest = browser('GET', 2 * MIN, { kind: 'client', attributes: { 'url.full': 'http://localhost:3000/api/x', 'http.status_code': 500 } })
      const origin1 = span('loadX', 2 * MIN, { traceId: viaRequest.traceId, parentSpanId: viaRequest.spanId, message: 'boom' })
      const viaCode = browser('GET /api/x', MIN, {})
      const origin2 = span('loadX', MIN, { traceId: viaCode.traceId, parentSpanId: viaCode.spanId, message: 'boom' })
      const [defect] = compute([viaRequest, origin1, viaCode, origin2])
      expect(defect.affected).toHaveLength(2)
      expect(defect.affected.find((a) => a.spanName === 'GET')).toMatchObject({ operation: 'GET /api/x', count: 1 })
      expect(defect.affected.find((a) => a.spanName === 'GET /api/x')).toMatchObject({ operation: 'GET /api/x', count: 1 })
    })
  })

  it('a failure with no message but an HTTP status says the status; without either — "(no message)"', () => {
    const coded = (code: number | string) => span('POST /api/checkout', MIN, { kind: 'server', attributes: { 'http.response.status_code': code } })
    expect(compute([coded(500)])[0].message).toBe('HTTP 500')
    expect(compute([coded('503')])[0].message).toBe('HTTP 503')
    // A real message wins over the status; a 2xx on a failed span explains nothing.
    expect(compute([{ ...coded(500), statusMessage: 'Internal Server Error' }])[0].message).toBe('Internal Server Error')
    expect(compute([coded(200)])[0].message).toBe('(no message)')
    expect(compute([span('job', MIN)])[0].message).toBe('(no message)')
  })

  it('when old spans were dropped, "new" needs evidence that the operation ran in the previous version', () => {
    const fresh = span('applyCoupon', MIN, { message: 'coupon is undefined', serviceVersion: 'v2' })
    const asked: string[] = []
    const ranIn = (ran: boolean) => (service: string, operation: string, version: string) => (asked.push(`${service}/${operation}@${version}`), ran)
    // Its v1 occurrences may simply be gone: not called new…
    expect(compute([fresh], { historyComplete: false })[0].isNew).toBe(false)
    expect(compute([fresh], { historyComplete: false, ranIn: ranIn(false) })[0].isNew).toBe(false)
    // …unless v1 calls of the same operation are still stored — and none of them failed like this.
    expect(compute([fresh], { historyComplete: false, ranIn: ranIn(true) })[0].isNew).toBe(true)
    expect(asked).toEqual(['shop/applyCoupon@v1', 'shop/applyCoupon@v1'])
    // A defect that is not first seen in the latest version is never new, evidence or not.
    expect(compute([span('a', MIN, { message: 'x', serviceVersion: 'v1' })], { historyComplete: false, ranIn: ranIn(true) })[0].isNew).toBe(false)
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

  it('on the workshop shop: the receipt email that v2 broke comes first, then the old inventory timeout', async () => {
    const storage = await shopStorage()
    const failed = await storage.querySpans({ status: 'error', limit: Number.MAX_SAFE_INTEGER })
    const deployOrder = new Map((await storage.getServices()).map((s) => [s.name, s.versions]))
    const defects = computeDefects(failed, { nowMs: NOW, windowMs: 15 * MIN, buckets: 30, deployOrder, historyComplete: storage.isHistoryComplete() })
    expect(defects).toHaveLength(2)
    // Guest checkouts: 5 of the 30 in v2. The request itself answers 200, so nothing is "affected".
    expect(defects[0]).toMatchObject({ operation: 'sendReceiptEmail', type: 'TypeError', message: "Cannot read properties of undefined (reading 'email')", count: 5, isNew: true, firstSeenVersion: 'v2', versions: ['v2'], affected: [] })
    expect(defects[1]).toMatchObject({ operation: 'inventory.check', message: 'Inventory service timeout: upstream not responding', isNew: false, versions: ['v1', 'v2'], affected: [{ operation: 'GET /api/inventory/[id]' }] })
  })
})

describe('MemoryStorage.isHistoryComplete', () => {
  it('true until the first span is dropped to make room', async () => {
    const storage = new MemoryStorage({ maxSpans: 2 })
    await storage.insertSpans([span('a', 3 * MIN), span('a', 2 * MIN)])
    expect(storage.isHistoryComplete()).toBe(true)
    await storage.insertSpans([span('a', MIN)])
    expect(storage.isHistoryComplete()).toBe(false)
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

  it('after eviction a v2-only defect is new only if its operation is still on record in v1', async () => {
    const storage = new MemoryStorage({ maxSpans: 4 })
    const healthy = (name: string, agoMs: number, serviceVersion: string) => span(name, agoMs, { status: 'unset', serviceVersion })
    // The first span is dropped; what is left: applyCoupon ran fine in v1 and fails in v2, sendEmail fails in v2 only.
    await storage.insertSpans([healthy('old', 9 * MIN, 'v1'), healthy('applyCoupon', 8 * MIN, 'v1'), healthy('warmup', 3 * MIN, 'v2')])
    await storage.insertSpans([span('applyCoupon', 2 * MIN, { message: 'coupon is undefined', serviceVersion: 'v2' }), span('sendEmail', MIN, { message: 'SMTP refused', serviceVersion: 'v2' })])
    expect(storage.isHistoryComplete()).toBe(false)
    collector = await startCollector({ port: 0, storage, uiDir: false })
    const defects = (await (await fetch(`${collector.url}/api/defects?windowMs=${10 * MIN}&toMs=${NOW}`)).json()) as Defect[]
    expect(defects.map((d) => [d.operation, d.isNew])).toEqual([
      ['applyCoupon', true],
      ['sendEmail', false],
    ])
  })
})

describe('sameRoute', () => {
  it('the server’s pattern and the browser’s request to it are one route', () => {
    expect(sameRoute('GET /api/inventory/[id]', 'GET /api/inventory/:id')).toBe(true)
    expect(sameRoute('GET /api/orders/[orderId]/items/[itemId]', 'GET /api/orders/:id/items/:id')).toBe(true)
    expect(sameRoute('GET /api/lab', 'GET /api/lab')).toBe(true)
  })

  it('different routes or methods stay different', () => {
    expect(sameRoute('GET /api/inventory/[id]', 'GET /api/products/:id')).toBe(false)
    expect(sameRoute('GET /api/inventory/[id]', 'POST /api/inventory/:id')).toBe(false)
    expect(sameRoute('checkInventory', 'GET /api/inventory/:id')).toBe(false)
    expect(sameRoute('GET /api/users/[id]', 'GET /api/users/:identity')).toBe(false)
  })
})

describe('describeDefect', () => {
  const base = { message: 'x is undefined', isNew: false, firstSeenVersion: 'v1', versions: ['v1'], affected: [] }

  it('a browser error is not "an operation that fails": it happened in the browser, on a page', () => {
    expect(describeDefect({ ...base, operation: 'uncaught error', category: 'browser-error', pages: [{ path: '/product/3' }, { path: '/cart' }] })).toBe('In the browser on /product/3, /cart: uncaught error "x is undefined"')
    expect(describeDefect({ ...base, operation: 'console.error', category: 'browser-error', pages: [] })).toBe('In the browser: console.error "x is undefined"')
  })

  it('a request is named as a request; code as before', () => {
    expect(describeDefect({ ...base, operation: 'GET /api/coupons/:id', message: 'HTTP 404', category: 'request', source: 'browser' })).toBe('The browser\'s request GET /api/coupons/:id fails with "HTTP 404"')
    // A call the server made to another service is not the browser's.
    expect(describeDefect({ ...base, operation: 'GET /api/charge/:id', message: 'HTTP 503', category: 'request', source: 'server' })).toBe('The outgoing request GET /api/charge/:id fails with "HTTP 503"')
    expect(describeDefect({ ...base, operation: 'GET /api/charge/:id', message: 'HTTP 503', category: 'request' })).toBe('The outgoing request GET /api/charge/:id fails with "HTTP 503"')
    expect(describeDefect({ ...base, operation: 'checkInventory', category: 'code', affected: [{ operation: 'GET /api/inventory/[id]' }] })).toBe('checkInventory fails with "x is undefined" (requests to GET /api/inventory/[id] fail because of it)')
    // The browser's request to the failing route itself is not "another request failing because of it".
    expect(describeDefect({ ...base, operation: 'GET /api/inventory/[id]', category: 'code', affected: [{ operation: 'GET /api/inventory/:id' }] })).toBe('GET /api/inventory/[id] fails with "x is undefined"')
    // No category given (older callers): treated as code.
    expect(describeDefect({ ...base, operation: 'checkInventory' })).toBe('checkInventory fails with "x is undefined"')
  })

  it('the question for the AI agents starts from that description', () => {
    expect(questionFor({ ...base, operation: 'uncaught error', category: 'browser-error', pages: [{ path: '/lab' }], isNew: true, firstSeenVersion: 'v2' })).toBe(
      'In the browser on /lab: uncaught error "x is undefined". It first appeared in v2. Why does it fail, and is it new?',
    )
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
