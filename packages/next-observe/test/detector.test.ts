import { describe, expect, it } from 'vitest'
import type { NormalizedSpan } from '../src/collector/types.js'
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

  it('forgets requests older than the window', () => {
    const c = clock()
    const d = new AnomalyDetector({ now: c.now })
    d.observe(Array.from({ length: 10 }, () => failing('GET /x')))
    c.advance(11_000)
    d.observe(Array.from({ length: 10 }, () => request('GET /')))
    expect(d.check()).toEqual([])
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
