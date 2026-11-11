import { ValueType } from '@opentelemetry/api'
import { JsonMetricsSerializer, ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'

type ResourceMetrics = Parameters<typeof JsonMetricsSerializer.serializeRequest>[0]
/** Upstream SDK export model → official serializers; enum values follow installed SDK 2.11.0. */
export function performanceMetrics() {
  const startTime: [number, number] = [1_800_000_000, 123456789]
  const endTime: [number, number] = [1_800_000_001, 123456789]
  const attributes = { scenario: 'search', variant: 'degraded' }
  const descriptor = (name: string, unit = 's', valueType = ValueType.DOUBLE) => ({ name, unit, description: `${name} fixture`, valueType })
  // The serializer preserves OTLP scope attributes although this SDK's public scope type is narrower.
  const scope = { name: 'performance-metrics', version: '1.2.3', schemaUrl: 'https://example.test/scope/v1', attributes: { language: 'js' } }
  const source: ResourceMetrics = {
    resource: resourceFromAttributes({ 'service.name': 'metric-fixture', 'service.version': 'v1' }, { schemaUrl: 'https://example.test/resource/v1' }),
    scopeMetrics: [{
      scope,
      metrics: [
        { descriptor: descriptor('calls', '{call}', ValueType.INT), dataPointType: 3, aggregationTemporality: 1, isMonotonic: true, dataPoints: [{ startTime, endTime, attributes, value: 7 }] },
        { descriptor: descriptor('active', '1', ValueType.INT), dataPointType: 3, aggregationTemporality: 0, isMonotonic: false, dataPoints: [{ startTime, endTime, attributes, value: -3 }] },
        { descriptor: descriptor('memory', 'By'), dataPointType: 2, aggregationTemporality: 1, dataPoints: [{ startTime, endTime, attributes, value: 42 }] },
        { descriptor: descriptor('interaction.duration'), dataPointType: 0, aggregationTemporality: 0, dataPoints: [{ startTime, endTime, attributes, value: { count: 10, sum: 4.6, min: 0.02, max: 2, buckets: { boundaries: [0.1, 0.5, 1], counts: [2, 4, 3, 1] } } }] },
      ],
    }],
  }
  return { source, json: JSON.parse(new TextDecoder().decode(JsonMetricsSerializer.serializeRequest(source)!)), protobuf: ProtobufMetricsSerializer.serializeRequest(source)! }
}
