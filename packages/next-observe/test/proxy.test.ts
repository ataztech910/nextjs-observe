import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES, POST } from '../src/proxy.js'

const ENV = ['OBSERVE_ENDPOINT', 'OBSERVE_API_KEY', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_HEADERS']
const sent: { url: string; init: RequestInit }[] = []

beforeEach(() => {
  sent.length = 0
  for (const key of ENV) vi.stubEnv(key, undefined as unknown as string)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response('{"partialSuccess":{}}', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const call = (path: string[], body = '{"resourceSpans":[]}', headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://app.local/api/next-observe/' + path.join('/'), { method: 'POST', headers, body }), { params: Promise.resolve({ path }) })

describe('next-observe/proxy', () => {
  it('forwards browser spans to the configured backend with the server-side headers', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://api.vendor.io/otlp/traces')
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=Bearer%20secret')
    const res = await call(['v1', 'traces'])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ partialSuccess: {} })
    expect(sent[0].url).toBe('https://api.vendor.io/otlp/traces')
    expect(sent[0].init.headers).toEqual({ Authorization: 'Bearer secret', 'content-type': 'application/json' })
    expect(new TextDecoder().decode(sent[0].init.body as ArrayBuffer)).toBe('{"resourceSpans":[]}')
  })

  it('reads the destination at request time, not at build time', async () => {
    vi.stubEnv('OBSERVE_ENDPOINT', 'http://one:4318')
    await call(['v1', 'traces'])
    vi.stubEnv('OBSERVE_ENDPOINT', 'http://two:4318')
    await call(['v1', 'traces'])
    expect(sent.map((s) => s.url)).toEqual(['http://one:4318/v1/traces', 'http://two:4318/v1/traces'])
  })

  it('passes the upstream status through (e.g. a 401 from the backend)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })))
    expect((await call(['v1', 'traces'])).status).toBe(401)
  })

  it('forwards only traces', async () => {
    expect((await call(['v1', 'metrics'])).status).toBe(404)
    expect((await call([])).status).toBe(404)
    expect(sent).toHaveLength(0)
  })

  it('rejects oversized bodies, by header and by actual size', async () => {
    expect((await call(['v1', 'traces'], '{}', { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) })).status).toBe(413)
    expect((await call(['v1', 'traces'], 'x'.repeat(MAX_BODY_BYTES + 1))).status).toBe(413)
    expect(sent).toHaveLength(0)
  })

  it('answers 502 when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await call(['v1', 'traces'])
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'trace backend unreachable' })
  })
})

describe('next-observe/proxy: several destinations', () => {
  beforeEach(() => {
    vi.stubEnv('OBSERVE_ENDPOINT', 'http://observer:4318')
    vi.stubEnv('OBSERVE_API_KEY', 'observer-key')
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://api.vendor.io/otlp/traces')
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=Bearer%20vendor')
  })

  it('sends the spans to each destination with its own headers', async () => {
    expect((await call(['v1', 'traces'])).status).toBe(200)
    expect(sent.map((s) => [s.url, s.init.headers])).toEqual([
      ['https://api.vendor.io/otlp/traces', { Authorization: 'Bearer vendor', 'content-type': 'application/json' }],
      ['http://observer:4318/v1/traces', { 'x-api-key': 'observer-key', 'content-type': 'application/json' }],
    ])
  })

  it('answers with the first destination; a slow or failing other one neither delays nor fails the browser', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      url.startsWith('http://observer') ? Promise.resolve(new Response('{}', { status: 200 })) : new Promise(() => {}),
    ))
    expect((await call(['v1', 'traces'])).status).toBe(200)

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('http://observer')) return new Response('{}', { status: 200 })
      throw new TypeError('fetch failed')
    }))
    expect((await call(['v1', 'traces'])).status).toBe(200)
  })
})
