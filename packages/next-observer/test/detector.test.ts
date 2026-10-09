import { describe, expect, it } from 'vitest'
import type { AttributeValue, NormalizedSpan } from '../src/collector/types.js'
import { AnomalyDetector, questionFor } from '../src/debug/detector.js'

let seq = 0
function request(name: string, extra: Partial<NormalizedSpan> = {}): NormalizedSpan {
  seq++
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name,
    kind: 'server',
    service: 'shop',
    serviceVersion: 'v2',
    scope: null,
    startTimeMs: 0,
    durationMs: 50,
    status: 'unset',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: [],
    ...extra,
  }
}
const failing = (name: string) => request(name, { status: 'error' })
const slow = (name: string) => request(name, { durationMs: 2400 })
const internal = (status: NormalizedSpan['status']) => request('render route (app) /x', { kind: 'internal', status })
// Fast, 2xx by every other measure — status stays 'unset'/healthy and duration stays the 50 ms default. Only the
// event says anything is wrong, exactly the point of incident F: a transaction-pooling connection returned another
// concurrent query's result, not an error and not a hang.
const wrongData = (name: string, expected: AttributeValue, actual: AttributeValue) =>
  request(name, { events: [{ name: 'integrity_check', timeMs: 0, attributes: { ok: false, expected, actual } }] })

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('AnomalyDetector', () => {
  it('stays quiet on healthy traffic', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(Array.from({ length: 20 }, () => request('GET /')))
    expect(d.check()).toEqual([])
  })

  it('flags a high error rate with the failing operation first', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 6 }, () => request('GET /api/products')), ...Array.from({ length: 4 }, () => failing('GET /api/inventory/[id]'))])
    const [anomaly] = d.check()
    expect(anomaly).toMatchObject({ type: 'high_error_rate', value: 0.4, threshold: 0.2, sampleSize: 10, severity: 'critical' })
    expect(anomaly.operations[0]).toMatchObject({ operation: 'GET /api/inventory/[id]', errors: 4, count: 4 })
    expect(anomaly.operations.map((o) => o.operation)).not.toContain('GET /api/products')
  })

  it('counts only server requests: internal Next spans do not dilute the rate', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    // 3 of 10 requests fail; each request also has 7 healthy internal spans → 3/80 overall, 30% per request
    d.observe([...Array.from({ length: 7 }, () => request('GET /')), ...Array.from({ length: 3 }, () => failing('GET /x')), ...Array.from({ length: 70 }, () => internal('unset'))])
    expect(d.check().map((a) => a.type)).toEqual(['high_error_rate'])
  })

  it('flags a high share of slow requests', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 6 }, () => request('GET /')), ...Array.from({ length: 4 }, () => slow('POST /api/checkout'))])
    const [anomaly] = d.check()
    expect(anomaly).toMatchObject({ type: 'high_latency', value: 0.4, severity: 'warning' })
    expect(anomaly.operations[0]).toMatchObject({ operation: 'POST /api/checkout', slow: 4 })
  })

  it('does not judge rates on too few requests (1 of 1 is not 100%)', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([failing('GET /x'), failing('GET /x'), request('GET /')])
    expect(d.check()).toEqual([])
  })

  it('forgets requests older than the window: 10 s app-wide, 30 s per operation', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(Array.from({ length: 10 }, () => failing('GET /x')))
    c.advance(11_000)
    d.observe(Array.from({ length: 10 }, () => request('GET /')))
    // App-wide the failures are gone; GET /x on its own still is within its 30 s window.
    expect(d.check().map((a) => [a.scope, a.subject?.operation, a.windowMs])).toEqual([['operation', 'GET /x', 30_000]])

    const later = new AnomalyDetector({ now: c.now })
    later.observe(Array.from({ length: 10 }, () => failing('GET /x')))
    c.advance(31_000)
    later.observe(Array.from({ length: 10 }, () => request('GET /')))
    expect(later.check()).toEqual([])
  })

  it('reports the same anomaly type once per cooldown, then again', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    const burst = () => d.observe(Array.from({ length: 10 }, () => failing('GET /x')))
    burst()
    expect(d.check()).toHaveLength(1)
    c.advance(5_000)
    burst()
    expect(d.check()).toEqual([])
    c.advance(300_000)
    burst()
    expect(d.check()).toHaveLength(1)
  })

  it('flags a single wrong-data response even with no error and no slowness (no minSamples gate)', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    // Just 2 requests total — well under minSamples (5) for the rate-based rules, and both otherwise "healthy".
    d.observe([request('GET /api/probe'), wrongData('GET /api/probe', 1, 24)])
    const [anomaly] = d.check()
    expect(anomaly).toMatchObject({ type: 'data_integrity', severity: 'critical', value: 1, sampleSize: 1 })
    expect(anomaly.integrityFailures).toEqual([{ service: 'shop', operation: 'GET /api/probe', traceId: expect.any(String), expected: 1, actual: 24 }])
  })

  it('flags a wrong-data response even when the event sits on an internal child span, not the server entry span', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    // The real-world shape: the verifying code is a db.query child span (kind: 'internal'), not the route's own
    // server-entry span — isServerRequest would be false for it, and it must still be seen.
    const dbQuery = request('db.query', { kind: 'internal', events: [{ name: 'integrity_check', timeMs: 0, attributes: { ok: false, expected: 'cart-42', actual: 'cart-17' } }] })
    d.observe([request('GET /api/cart'), dbQuery])
    const [anomaly] = d.check()
    expect(anomaly).toMatchObject({ type: 'data_integrity', sampleSize: 1 })
    expect(anomaly.integrityFailures).toEqual([{ service: 'shop', operation: 'db.query', traceId: expect.any(String), expected: 'cart-42', actual: 'cart-17' }])
  })

  it('does not confuse a wrong-data response with an error or a slow one', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([wrongData('GET /api/probe', 1, 24)])
    expect(d.check().map((a) => a.type)).toEqual(['data_integrity'])
  })

  it('carries the expected/actual evidence into the question for the agents', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([wrongData('GET /api/probe', 1, 24)])
    expect(questionFor(d.check()[0])).toContain('asked for 1, got back 24')
  })

  it('flags silence only after traffic was seen', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    c.advance(500_000)
    expect(d.check()).toEqual([]) // never had traffic
    d.observe([request('GET /')])
    c.advance(121_000)
    expect(d.check()).toMatchObject([{ type: 'no_traffic', value: 121, sampleSize: 0 }])
  })
})

describe('AnomalyDetector per operation', () => {
  // Porto Shop under `npm run load`: inventory is 1 of 3 routes here and fails 30% of the time → 10% overall.
  const realisticMix = () => [
    ...Array.from({ length: 7 }, () => request('GET /api/inventory/[id]')),
    ...Array.from({ length: 3 }, () => failing('GET /api/inventory/[id]')),
    ...Array.from({ length: 10 }, () => request('GET /')),
    ...Array.from({ length: 10 }, () => request('POST /api/checkout')),
  ]

  it('catches one broken operation that stays below the app-wide threshold', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(realisticMix())
    const found = d.check()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      type: 'high_error_rate',
      scope: 'operation',
      subject: { service: 'shop', operation: 'GET /api/inventory/[id]' },
      value: 0.3,
      sampleSize: 10,
    })
  })

  it('needs enough requests of that operation too', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 4 }, () => failing('GET /rare')), ...Array.from({ length: 40 }, () => request('GET /'))])
    expect(d.check()).toEqual([])
  })

  it('keeps a separate cooldown per operation', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    const broken = (name: string) => [...Array.from({ length: 6 }, () => failing(name)), ...Array.from({ length: 4 }, () => request(name))]
    d.observe([...broken('GET /a'), ...Array.from({ length: 40 }, () => request('GET /'))])
    expect(d.check().map((a) => a.subject?.operation)).toEqual(['GET /a'])
    c.advance(5_000)
    d.observe([...broken('GET /a'), ...broken('GET /b'), ...Array.from({ length: 40 }, () => request('GET /'))])
    expect(d.check().map((a) => a.subject?.operation)).toEqual(['GET /b'])
  })

  it('does not repeat an app-wide anomaly per operation', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(Array.from({ length: 10 }, () => failing('GET /x')))
    expect(d.check().map((a) => a.scope)).toEqual(['all'])
  })

  it('asks the agents about that operation', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(realisticMix())
    expect(questionFor(d.check()[0])).toMatch(/^Anomaly detected: 30% of GET \/api\/inventory\/\[id\] requests failed in the last 30s \(10 requests\)/)
  })
})

describe('questionFor', () => {
  it('turns the anomaly into a question that carries the evidence', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 6 }, () => request('GET /')), ...Array.from({ length: 4 }, () => failing('GET /api/inventory/[id]'))])
    expect(questionFor(d.check()[0])).toBe(
      'Anomaly detected: 40% of server requests failed in the last 10s (10 requests). Most affected: GET /api/inventory/[id] (shop: 4 errors, 0 slow of 4). Find the failing operation, the exact error and its source.',
    )
  })
})

describe('AnomalyDetector: an operation with modest traffic (the workshop rehearsal)', () => {
  // npm run load: 3 requests/s over 5 routes — checkout gets ~0.6/s. v2's payment makes every checkout ~2.4 s.
  it('catches the slow checkout on its own, although 10 s never hold minSamples checkouts', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    const found = []
    for (let second = 0; second < 30; second++) {
      c.advance(1000)
      const traffic = [request('GET /'), request('GET /api/products'), request('GET /api/inventory/[id]')]
      if (second % 5 < 3) traffic.push(slow('POST /api/checkout')) // 3 checkouts every 5 s
      d.observe(traffic)
      if (second % 5 === 4) found.push(...d.check())
    }
    expect(found.map((a) => [a.type, a.subject?.operation ?? 'all'])).toContainEqual(['high_latency', 'POST /api/checkout'])
    // Slow requests are under 20% of all traffic: the app-wide rule alone would never fire here.
    expect(found.some((a) => a.type === 'high_latency' && a.scope === 'all')).toBe(false)
  })
})

describe('AnomalyDetector: one problem, one investigation', () => {
  const kinds = (found: { type: string; subject?: { operation: string } }[]) => found.map((a) => [a.type, a.subject?.operation ?? 'all'])

  it('an app-wide anomaly that only repeats an operation anomaly from an earlier check is skipped', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    // 30 s of traffic: inventory fails 1 in 3 — enough for its own rule, not yet app-wide in 10 s.
    const found = []
    for (let second = 0; second < 30; second++) {
      c.advance(1000)
      d.observe([request('GET /'), second % 3 === 0 ? failing('GET /api/inventory/[id]') : request('GET /api/inventory/[id]')])
      if (second % 5 === 4) found.push(...d.check())
    }
    // Then a burst that makes it app-wide too — still the same problem.
    c.advance(1000)
    d.observe([...Array.from({ length: 6 }, () => failing('GET /api/inventory/[id]')), request('GET /')])
    found.push(...d.check())
    expect(kinds(found)).toEqual([['high_error_rate', 'GET /api/inventory/[id]']])
  })

  it('an operation anomaly after an app-wide one that already named it is skipped', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 6 }, () => slow('POST /api/checkout')), ...Array.from({ length: 4 }, () => request('GET /'))])
    const first = d.check()
    expect(kinds(first)).toEqual([['high_latency', 'all']])
    c.advance(12_000) // past the app-wide window, still inside the operation one
    d.observe(Array.from({ length: 4 }, () => request('GET /')))
    expect(d.check()).toEqual([])
  })

  it('an app-wide anomaly with a culprit nobody reported yet is still reported', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe([...Array.from({ length: 5 }, () => failing('GET /a')), ...Array.from({ length: 20 }, () => request('GET /'))])
    expect(kinds(d.check())).toEqual([['high_error_rate', 'GET /a']])
    c.advance(1000)
    d.observe([...Array.from({ length: 6 }, () => failing('GET /b')), ...Array.from({ length: 6 }, () => failing('GET /a'))])
    expect(kinds(d.check())).toEqual([['high_error_rate', 'all']])
  })

  it('after the cooldown the same problem is reported again', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now, cooldownMs: 60_000 })
    const burst = () => d.observe([...Array.from({ length: 6 }, () => failing('GET /a')), ...Array.from({ length: 4 }, () => request('GET /'))])
    burst()
    expect(kinds(d.check())).toEqual([['high_error_rate', 'all']])
    c.advance(61_000)
    burst()
    expect(kinds(d.check())).toEqual([['high_error_rate', 'all']])
  })

  it('an old operation report stops explaining things after the cooldown', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now, cooldownMs: 60_000 })
    d.observe([...Array.from({ length: 5 }, () => failing('GET /a')), ...Array.from({ length: 20 }, () => request('GET /'))])
    expect(kinds(d.check())).toEqual([['high_error_rate', 'GET /a']])
    c.advance(61_000)
    d.observe([...Array.from({ length: 6 }, () => failing('GET /a')), ...Array.from({ length: 4 }, () => request('GET /'))])
    expect(kinds(d.check())).toEqual([['high_error_rate', 'all']])
  })

  it('the rehearsal traffic: inventory failing and checkout slow give exactly two investigations', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    const found = []
    for (let second = 0; second < 60; second++) {
      c.advance(1000)
      const traffic = [request('GET /'), request('GET /api/products'), second % 3 === 0 ? failing('GET /api/inventory/[id]') : request('GET /api/inventory/[id]')]
      if (second % 5 < 3) traffic.push(slow('POST /api/checkout'))
      d.observe(traffic)
      if (second % 5 === 4) found.push(...d.check())
    }
    expect(kinds(found).sort()).toEqual([['high_error_rate', 'GET /api/inventory/[id]'], ['high_latency', 'POST /api/checkout']])
  })
})
