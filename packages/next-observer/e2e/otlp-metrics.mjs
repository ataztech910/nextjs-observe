// Build/pack/extract first: node e2e/otlp-metrics.mjs /path/to/extracted/package [--serve]
// Actual MeterProvider aggregation → upstream serializers → packed HTTP receiver/query API.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { JsonMetricsSerializer, ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { AggregationTemporality, AggregationType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics'

if (!process.argv[2]) throw new Error('Pass the extracted npm package directory')
const root = resolve(process.argv[2])
const { startCollector } = await import(pathToFileURL(resolve(root, 'dist/collector/index.js')).href)
const collector = await startCollector({ port: 0 })
class Reader extends MetricReader {
  async onForceFlush() {}
  async onShutdown() {}
}
const reader = new Reader({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE })
const provider = new MeterProvider({
  resource: resourceFromAttributes({ 'service.name': 'metric-smoke', 'service.version': 't2' }),
  readers: [reader],
  views: [{ instrumentName: 'interaction.duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [0.1, 0.5, 1] } } }],
})
let serve = false
try {
  const meter = provider.getMeter('metric-smoke', '1.2.3')
  const attributes = { scenario: 'search', variant: 'degraded' }
  meter.createCounter('calls').add(2, attributes)
  meter.createUpDownCounter('active').add(-1, attributes)
  meter.createGauge('memory', { unit: 'By' }).record(42, attributes)
  const histogram = meter.createHistogram('interaction.duration', { unit: 's' })
  for (const duration of [0.02, 0.2, 0.6, 1.5]) histogram.record(duration, attributes)
  const collected = await reader.collect()
  assert.deepEqual(collected.errors, [])
  const data = collected.resourceMetrics
  for (const [serializer, type] of [[JsonMetricsSerializer, 'application/json'], [ProtobufMetricsSerializer, 'application/x-protobuf']]) {
    const response = await fetch(`${collector.url}/v1/metrics`, { method: 'POST', headers: { 'content-type': type, 'content-encoding': 'gzip' }, body: gzipSync(serializer.serializeRequest(data)) })
    assert.equal(response.status, 200, await response.text())
  }
  const queryUrl = `${collector.url}/api/performance/metrics?service=metric-smoke`
  const result = await (await fetch(queryUrl)).json()
  assert.equal(result.total, 4)
  assert.equal(result.historyComplete, true)
  const h = result.points.find((p) => p.name === 'interaction.duration')
  assert.equal(h.aggregationTemporality, 2)
  assert.deepEqual(h.point.bucketCounts, ['1', '1', '1', '1'])
  assert.equal(h.point.count, '4')
  assert.equal(h.quantiles.p95.approximate, true)
  assert.equal(h.scope.version, '1.2.3')
  assert.equal(result.points.find((p) => p.name === 'active').isMonotonic, false)
  assert.equal((await (await fetch(`${collector.url}/health`)).json()).spans, 0)
  assert.equal((await fetch(collector.url)).status, 200)
  console.log(JSON.stringify({ status: 'passed', packageRoot: root, url: collector.url, queryUrl, points: result.total, buckets: h.point.bucketCounts }))
  serve = process.argv.includes('--serve')
} finally {
  await provider.shutdown()
  if (!serve) await collector.close()
}
if (serve) {
  const stop = () => collector.close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
