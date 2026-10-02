import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { JsonTraceSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'
import { decodeOtlpJson } from '../src/collector/decode.js'
import { protobufToOtlpJson } from '../src/collector/protobuf.js'

// The same finished spans, serialized by the real OTel serializers both ways.
function finishedSpans() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'shop', 'service.version': 'v2', 'service.instance.id': 'p1', 'host.cpus': 8 }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const tracer = provider.getTracer('checkout-scope', '1.2.3')
  const root = tracer.startSpan('POST /api/checkout', {
    kind: SpanKind.SERVER,
    attributes: { 'http.status_code': 500, ratio: 0.25, cached: false, tags: ['a', 'b'], counts: [1, 2], offset: -42, 'üñí': 'çødé ✓' },
  })
  const child = tracer.startSpan('chargePayment', { kind: SpanKind.CLIENT, attributes: { 'code.filepath': 'lib/payment.ts' } }, trace.setSpan(context.active(), root))
  child.addEvent('retry', { attempt: 2 })
  child.recordException(new Error('card declined'))
  child.setStatus({ code: SpanStatusCode.ERROR, message: 'card declined' })
  child.end()
  root.end()
  return exporter.getFinishedSpans()
}

describe('OTLP/protobuf → same spans as OTLP/JSON', () => {
  const spans = finishedSpans()
  const fromJson = decodeOtlpJson(JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest(spans)!)))
  const fromProtobuf = decodeOtlpJson(protobufToOtlpJson(ProtobufTraceSerializer.serializeRequest(spans)!))

  it('decodes to exactly what the JSON path gives: ids, times, kinds, attributes, events, status, resource', () => {
    expect(fromProtobuf).toEqual(fromJson)
    expect(fromProtobuf).toHaveLength(2)
  })

  it('keeps the details that are easy to get wrong', () => {
    const root = fromProtobuf.find((s) => s.name === 'POST /api/checkout')!
    const child = fromProtobuf.find((s) => s.name === 'chargePayment')!
    expect(root.attributes).toMatchObject({ offset: -42, ratio: 0.25, cached: false, tags: ['a', 'b'], counts: [1, 2], 'üñí': 'çødé ✓' })
    expect(root.parentSpanId).toBeNull()
    expect(child.parentSpanId).toBe(root.spanId)
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(child.status).toBe('error')
    expect(child.statusMessage).toBe('card declined')
    expect(child.events.map((e) => e.name)).toEqual(['retry', 'exception'])
    expect(root.resource).toMatchObject({ 'service.instance.id': 'p1', 'host.cpus': 8 })
    expect(root.scope).toBe('checkout-scope')
    expect(root.durationMs).toBe(fromJson.find((s) => s.name === 'POST /api/checkout')!.durationMs)
  })
})

describe('protobufToOtlpJson on bad input', () => {
  it('throws on truncated messages instead of returning garbage', () => {
    const bytes = ProtobufTraceSerializer.serializeRequest(finishedSpans())!
    expect(() => protobufToOtlpJson(bytes.subarray(0, bytes.length - 7))).toThrow(/truncated/)
  })

  it('throws when a field claims more bytes than are left, instead of reading a shorter value', () => {
    // resource_spans (field 1, len) claims 5 bytes, only 2 follow — which would otherwise parse as an empty resource.
    expect(() => protobufToOtlpJson(new Uint8Array([0x0a, 0x05, 0x0a, 0x00]))).toThrow(/truncated/)
  })

  it('throws on wire types that are not in proto3 (groups, 6, 7) instead of skipping nothing', () => {
    expect(() => protobufToOtlpJson(new Uint8Array([0x0e]))).toThrow(/unsupported wire type 6/)
    expect(() => protobufToOtlpJson(new Uint8Array([0x0b]))).toThrow(/unsupported wire type 3/)
  })

  it('skips unknown fields (forward compatibility)', () => {
    const bytes = ProtobufTraceSerializer.serializeRequest(finishedSpans())!
    // Field 99, wire type 2, 3 bytes, prepended at the top level — a future addition the reader does not know.
    // Tag (99 << 3) | 2 = 794 is a two-byte varint: 0x9a 0x06.
    const withUnknown = new Uint8Array([0x9a, 0x06, 3, 1, 2, 3, ...bytes])
    expect(decodeOtlpJson(protobufToOtlpJson(withUnknown))).toEqual(decodeOtlpJson(protobufToOtlpJson(bytes)))
  })

  it('an empty body is an empty request', () => {
    expect(protobufToOtlpJson(new Uint8Array())).toEqual({ resourceSpans: [] })
  })
})
