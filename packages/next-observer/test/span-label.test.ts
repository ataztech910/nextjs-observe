import { describe, expect, it } from 'vitest'
import { MemoryStorage, spanLabel, spanOperation, type NormalizedSpan } from '../src/collector/index.js'
import { requestParts } from '../src/collector/span-label.js'

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
    // Words made of hex letters are words: a hex id has a digit in it.
    expect(get('http://localhost:3000/api/feedback')).toBe('GET /api/feedback')
    expect(get('http://localhost:3000/api/deadbeef')).toBe('GET /api/deadbeef')
    expect(get('http://localhost:3000/api/cafebabe/9f86d081')).toBe('GET /api/cafebabe/:id')
    // A long route name is still a name: only a long token WITH a digit is an opaque id.
    expect(get('http://localhost:3000/api/recently-viewed-products')).toBe('GET /api/recently-viewed-products')
    expect(get('http://localhost:3000/api/recommended_products_for_you')).toBe('GET /api/recommended_products_for_you')
    expect(get('http://localhost:3000/s/V1StGXR8_Z5jdHi6B-myT')).toBe('GET /s/:id')
    // …and a long lower-case name with separators and a digit is still a name; without separators it is a token.
    expect(get('http://localhost:3000/api/recently-viewed-products-v2')).toBe('GET /api/recently-viewed-products-v2')
    expect(get('http://localhost:3000/api/oauth2-authorization-callback')).toBe('GET /api/oauth2-authorization-callback')
    expect(get('http://localhost:3000/s/k3j4h5g6f7d8s9a0q1w2e3')).toBe('GET /s/:id')
  })

  it('anything that is not a method-only client span keeps its name', () => {
    expect(spanOperation(span('GET /api/inventory/[id]', 'server', { 'url.full': 'http://x/api/inventory/1' }))).toBe('GET /api/inventory/[id]')
    expect(spanOperation(span('chargePayment', 'internal'))).toBe('chargePayment')
    expect(spanOperation(span('uncaught error', 'internal', { 'url.path': '/product/3' }))).toBe('uncaught error')
    expect(spanOperation(span('GET', 'client'))).toBe('GET')
  })
})

describe('requestParts', () => {
  it('method and path of a method-only client span; undefined for anything else or a broken URL', () => {
    expect(requestParts(span('POST', 'client', { 'http.url': 'http://localhost:3000/api/checkout?x=1' }))).toEqual({ method: 'POST', pathname: '/api/checkout' })
    expect(requestParts(span('POST', 'server', { 'http.url': 'http://localhost:3000/api/checkout' }))).toBeUndefined()
    expect(requestParts(span('GET /api/x', 'client', { 'url.full': 'http://localhost:3000/api/x' }))).toBeUndefined()
    expect(requestParts(span('GET', 'client', { 'url.full': 'not a url' }))).toBeUndefined()
    expect(requestParts(span('GET', 'client'))).toBeUndefined()
  })
})
