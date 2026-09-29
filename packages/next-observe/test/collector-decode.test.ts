import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'
import { decodeOtlpJson } from '../src/collector/decode.js'

// Contract test: payload is produced by the same serializer the real OTLP/JSON exporter uses.
function exportedPayload() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'shop', 'service.version': 'v2' }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const tracer = provider.getTracer('checkout-scope')
  const root = tracer.startSpan('POST /api/checkout', {
    kind: SpanKind.SERVER,
    attributes: { 'http.status': 500, ratio: 0.25, cached: false, tags: ['a', 'b'], route: '/api/checkout' },
  })
  const child = tracer.startSpan('chargePayment', { kind: SpanKind.CLIENT }, trace.setSpan(context.active(), root))
  child.recordException(new Error('card declined'))
  child.setStatus({ code: SpanStatusCode.ERROR, message: 'card declined' })
  child.end()
  root.end()
  const spans = exporter.getFinishedSpans()
  const bytes = JsonTraceSerializer.serializeRequest(spans)!
  return { spans, request: JSON.parse(new TextDecoder().decode(bytes)) }
}

describe('decodeOtlpJson (contract with the OTel JSON serializer)', () => {
  const { spans, request } = exportedPayload()
  const decoded = decodeOtlpJson(request)
  const root = decoded.find((s) => s.name === 'POST /api/checkout')!
  const child = decoded.find((s) => s.name === 'chargePayment')!
  const original = (name: string) => spans.find((s) => s.name === name)!

  it('keeps ids and parent linkage as hex', () => {
    expect(root.traceId).toBe(original('POST /api/checkout').spanContext().traceId)
    expect(root.spanId).toBe(original('POST /api/checkout').spanContext().spanId)
    expect(root.parentSpanId).toBeNull()
    expect(child.parentSpanId).toBe(root.spanId)
    expect(child.traceId).toBe(root.traceId)
  })

  it('maps resource, scope, kind and status', () => {
    expect(root).toMatchObject({ service: 'shop', serviceVersion: 'v2', scope: 'checkout-scope', kind: 'server', status: 'unset' })
    expect(child).toMatchObject({ kind: 'client', status: 'error', statusMessage: 'card declined' })
    expect(root.resource['service.name']).toBe('shop')
  })

  it('decodes every attribute type', () => {
    expect(root.attributes).toEqual({ 'http.status': 500, ratio: 0.25, cached: false, tags: ['a', 'b'], route: '/api/checkout' })
  })

  it('keeps exception events', () => {
    expect(child.events).toHaveLength(1)
    expect(child.events[0].name).toBe('exception')
    expect(child.events[0].attributes['exception.message']).toBe('card declined')
  })

  it('converts nanosecond times to ms without losing sub-ms precision', () => {
    const o = original('chargePayment')
    const expectedStart = o.startTime[0] * 1000 + o.startTime[1] / 1e6
    const expectedDuration = o.duration[0] * 1000 + o.duration[1] / 1e6
    expect(child.startTimeMs).toBeCloseTo(expectedStart, 3)
    expect(child.durationMs).toBeCloseTo(expectedDuration, 3)
  })

  it('accepts numeric times and a missing resource', () => {
    const [span] = decodeOtlpJson({
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'x', startTimeUnixNano: 1_000_000, endTimeUnixNano: 3_500_000 }] }] }],
    })
    expect(span).toMatchObject({ service: 'unknown', serviceVersion: null, startTimeMs: 1, durationMs: 2.5, kind: 'unspecified' })
  })
})
