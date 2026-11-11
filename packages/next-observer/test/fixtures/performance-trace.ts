import { createTraceState, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { JsonTraceSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { OtlpTraceRequest } from '../../src/collector/otlp-types.js'

export const TRACE_ID = 'a'.repeat(32)
export const SPAN_ID = 'b'.repeat(16)
/** Independent upstream serializers provide the JSON/protobuf interoperability oracle. */
export function performanceTrace() {
  const source: ReadableSpan = {
    name: 'hook.compute', kind: SpanKind.INTERNAL,
    spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, traceState: createTraceState('vendor=sample') }),
    parentSpanContext: { traceId: TRACE_ID, spanId: 'c'.repeat(16), traceFlags: 1, isRemote: true },
    startTime: [1_800_000_000, 123456789], endTime: [1_800_000_000, 123456890], duration: [0, 101], ended: true,
    attributes: { 'observe.perf.phase': 'compute', 'experiment.variant': 'degraded' },
    status: { code: SpanStatusCode.OK },
    resource: resourceFromAttributes({ 'service.name': 'performance-fixture', 'service.version': 'v1' }, { schemaUrl: 'https://example.test/resource/v1' }),
    instrumentationScope: { name: 'performance-test', version: '1.2.3', schemaUrl: 'https://example.test/scope/v1' },
    links: [{ context: { traceId: 'd'.repeat(32), spanId: 'e'.repeat(16), traceFlags: 1, isRemote: true, traceState: createTraceState('vendor=linked') }, attributes: { reason: 'shared-work' }, droppedAttributesCount: 4 }],
    events: [{ name: 'commit', time: [1_800_000_000, 123456850], attributes: { committed: true }, droppedAttributesCount: 5 }],
    droppedAttributesCount: 2, droppedEventsCount: 3, droppedLinksCount: 6,
  }
  return {
    json: JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest([source])!)) as OtlpTraceRequest,
    protobuf: ProtobufTraceSerializer.serializeRequest([source])!,
  }
}
