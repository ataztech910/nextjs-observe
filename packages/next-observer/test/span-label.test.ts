import { describe, expect, it } from 'vitest'
import { MemoryStorage, spanLabel, type NormalizedSpan } from '../src/collector/index.js'

const span = (name: string, kind: NormalizedSpan['kind'], attributes: NormalizedSpan['attributes'] = {}) => ({ name, kind, attributes })

describe('spanLabel', () => {
  it('adds the path to an HTTP client span named by its method only', () => {
    expect(spanLabel(span('GET', 'client', { 'url.full': 'http://localhost:3000/api/inventory/2?x=1' }))).toBe('GET /api/inventory/2')
    expect(spanLabel(span('POST', 'client', { 'http.url': 'https://shop.example/api/checkout' }))).toBe('POST /api/checkout')
  })

  it('leaves every other span as it is', () => {
    expect(spanLabel(span('GET /api/products', 'server', { 'url.full': 'http://x/api/products' }))).toBe('GET /api/products')
    expect(spanLabel(span('GET', 'server', { 'url.full': 'http://x/a' }))).toBe('GET')
    expect(spanLabel(span('chargePayment', 'internal'))).toBe('chargePayment')
    expect(spanLabel(span('GET', 'client'))).toBe('GET')
    expect(spanLabel(span('GET', 'client', { 'url.full': 'not a url' }))).toBe('GET')
  })
})

describe('trace list: root name', () => {
  it('a browser fetch trace is listed with its path, not just "GET"', async () => {
    const storage = new MemoryStorage()
    await storage.insertSpans([{
      traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), parentSpanId: null, name: 'GET', kind: 'client', service: 'shop-browser',
      serviceVersion: null, scope: null, startTimeMs: 1, durationMs: 5, status: 'unset', statusMessage: null,
      attributes: { 'url.full': 'http://localhost:3000/api/inventory/2' }, resource: {}, events: [],
    }])
    expect((await storage.queryTraces({}))[0].rootName).toBe('GET /api/inventory/2')
  })
})
