import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startCollector, type Collector } from '../src/collector/index.js'

let collector: Collector

beforeAll(async () => {
  collector = await startCollector({ port: 0 })
  // The real OTLP/HTTP JSON exporter, as used by apps — not a hand-written payload.
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'shop', 'service.version': 'v2' }),
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${collector.url}/v1/traces` }))],
  })
  const tracer = provider.getTracer('test')
  const root = tracer.startSpan('POST /api/checkout', { kind: SpanKind.SERVER })
  const child = tracer.startSpan('chargePayment', {}, trace.setSpan(context.active(), root))
  child.setStatus({ code: SpanStatusCode.ERROR, message: 'declined' })
  child.end()
  root.end()
  await provider.forceFlush()
})

afterAll(() => collector.close())

const get = async (path: string) => {
  const res = await fetch(`${collector.url}${path}`)
  return { status: res.status, body: await res.json() }
}
const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }, url = collector.url) =>
  fetch(`${url}/v1/traces`, { method: 'POST', headers, body })

describe('collector: ingest from the real OTLP exporter + query API', () => {
  it('reports health with the span count', async () => {
    expect(await get('/health')).toEqual({ status: 200, body: { status: 'ok', spans: 2 } })
  })

  it('lists services with versions', async () => {
    const { body } = await get('/api/services')
    expect(body).toEqual([{ name: 'shop', versions: ['v2'], spanCount: 2, lastSeenMs: expect.any(Number) }])
  })

  it('searches traces and returns one with all its spans', async () => {
    const { body: traces } = await get('/api/traces?hasError=true&operation=charge')
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ rootName: 'POST /api/checkout', spanCount: 2, errorCount: 1 })

    const { status, body } = await get(`/api/traces/${traces[0].traceId}`)
    expect(status).toBe(200)
    expect(body.spans.map((s: { name: string }) => s.name)).toEqual(['POST /api/checkout', 'chargePayment'])
    expect(body.spans[1]).toMatchObject({ status: 'error', statusMessage: 'declined', parentSpanId: body.spans[0].spanId })
  })

  it('returns operation stats', async () => {
    const { body } = await get('/api/operations?operation=chargePayment')
    expect(body).toEqual([expect.objectContaining({ service: 'shop', operation: 'chargePayment', count: 1, errorCount: 1, errorRate: 1 })])
  })
})

describe('collector: errors', () => {
  it('415 for protobuf with a hint', async () => {
    const res = await post('x', { 'content-type': 'application/x-protobuf' })
    expect(res.status).toBe(415)
    expect((await res.json()).error).toContain('http/json')
  })

  it('400 for invalid JSON and bad query params, 404 for unknown trace and route', async () => {
    expect((await post('{nope')).status).toBe(400)
    expect((await get('/api/traces?minDurationMs=abc')).status).toBe(400)
    expect((await get('/api/traces?hasError=yes')).status).toBe(400)
    expect((await get(`/api/traces/${'0'.repeat(32)}`)).status).toBe(404)
    expect((await get('/nope')).status).toBe(404)
  })

  it('413 above maxBodyBytes and the response still arrives', async () => {
    const small = await startCollector({ port: 0, maxBodyBytes: 100 })
    try {
      const res = await post(JSON.stringify({ resourceSpans: [], pad: 'x'.repeat(1000) }), undefined, small.url)
      expect(res.status).toBe(413)
    } finally {
      await small.close()
    }
  })

  it('401 without the right x-api-key when apiKey is set', async () => {
    const secured = await startCollector({ port: 0, apiKey: 'obs_live_1' })
    try {
      const body = JSON.stringify({ resourceSpans: [] })
      expect((await post(body, undefined, secured.url)).status).toBe(401)
      expect((await post(body, { 'content-type': 'application/json', 'x-api-key': 'wrong' }, secured.url)).status).toBe(401)
      expect((await post(body, { 'content-type': 'application/json', 'x-api-key': 'obs_live_1' }, secured.url)).status).toBe(200)
    } finally {
      await secured.close()
    }
  })

  it('answers CORS preflight', async () => {
    const res = await fetch(`${collector.url}/v1/traces`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
