import { describe, expect, it } from 'vitest'
import { MemoryStorage, spanLabel, spanOperation, type NormalizedSpan } from '../src/collector/index.js'

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

describe('spanOperation', () => {
  const get = (url: string) => spanOperation(span('GET', 'client', { 'url.full': url }))

  it('a client request is grouped by method and path, with id-like segments replaced', () => {
    expect(get('http://localhost:3000/api/inventory/1')).toBe('GET /api/inventory/:id')
    expect(get('http://localhost:3000/api/inventory/2?fresh=1')).toBe('GET /api/inventory/:id')
    expect(get('https://shop.example/api/orders/550e8400-e29b-41d4-a716-446655440000/items/17')).toBe('GET /api/orders/:id/items/:id')
    expect(get('https://shop.example/files/9f86d081884c7d65')).toBe('GET /files/:id')
    expect(get('https://shop.example/s/V1StGXR8_Z5jdHi6B-myT')).toBe('GET /s/:id')
  })

  it('words stay words: a short or ordinary segment is not an id', () => {
    expect(get('http://localhost:3000/api/products')).toBe('GET /api/products')
    expect(get('http://localhost:3000/api/v2/checkout')).toBe('GET /api/v2/checkout')
    expect(get('http://localhost:3000/')).toBe('GET /')
    // "deadbeef" is hex and 8 long — an id by this rule; "feedback" is not hex.
    expect(get('http://localhost:3000/api/feedback')).toBe('GET /api/feedback')
  })

  it('anything that is not a method-only client span keeps its name', () => {
    expect(spanOperation(span('GET /api/inventory/[id]', 'server', { 'url.full': 'http://x/api/inventory/1' }))).toBe('GET /api/inventory/[id]')
    expect(spanOperation(span('chargePayment', 'internal'))).toBe('chargePayment')
    expect(spanOperation(span('uncaught error', 'internal', { 'url.path': '/product/3' }))).toBe('uncaught error')
    expect(spanOperation(span('GET', 'client'))).toBe('GET')
  })
})
