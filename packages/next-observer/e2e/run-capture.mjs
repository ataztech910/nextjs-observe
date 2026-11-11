// node e2e/run-capture.mjs /path/to/extracted/package [--serve]
// Actual SDKs → upstream serializers → packed receiver → disk archive → restart/export/replay.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { JsonTraceSerializer, ProtobufTraceSerializer, JsonMetricsSerializer, ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { AggregationType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics'

if (!process.argv[2]) throw new Error('Pass the extracted npm package directory')
const root = resolve(process.argv[2])
const { RunCapture, replayRun, hashArtifact, startCollector } = await import(pathToFileURL(join(root, 'dist/collector/index.js')).href)
const temporary = await mkdtemp(join(tmpdir(), 'observe-run-smoke-'))
const directory = join(temporary, 'capture')
const capture = new RunCapture(directory)
let collector = await startCollector({ port: 0, capture })
const memory = new InMemorySpanExporter()
const resource = resourceFromAttributes({ 'service.name': 'run-smoke', 'service.version': 't3' })
const traceProvider = new BasicTracerProvider({ resource, spanProcessors: [new SimpleSpanProcessor(memory)] })
class Reader extends MetricReader { async onForceFlush() {} async onShutdown() {} }
const reader = new Reader()
const metricProvider = new MeterProvider({ resource, readers: [reader], views: [{ instrumentName: 'interaction.duration', aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: [0.1, 0.5, 1] } } }] })
let serve = false
try {
  const profilePath = join(temporary, 'profile.json')
  await writeFile(profilePath, JSON.stringify({ fixture: 'external-report-reference' }))
  const artifact = await hashArtifact(profilePath, 'application/json')
  const post = async (path, payload) => {
    const response = await fetch(`${collector.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    assert.ok(response.ok, await response.text())
  }
  for (const [runId, variant] of [['run-A', 'baseline'], ['run-B', 'degraded']]) {
    await post('/api/performance/runs', { runId, metadata: { experiment: 'C', variant, platform: 'node-smoke', artifacts: [artifact], sources: [{ name: 'manual-span', available: true }], clocks: [{ source: 'sdk-epoch', uncertaintyNs: null }] } })
  }
  const tracer = traceProvider.getTracer('run-smoke', '1.0')
  const span = tracer.startSpan('hook.compute', { attributes: { 'observe.perf.phase': 'compute', 'experiment.variant': 'baseline' } })
  span.addEvent('commit')
  span.end()
  await traceProvider.forceFlush()
  const histogram = metricProvider.getMeter('run-smoke', '1.0').createHistogram('interaction.duration', { unit: 's' })
  for (const sample of [0.02, 0.2, 0.6, 1.5]) histogram.record(sample, { 'experiment.variant': 'baseline' })
  const metrics = (await reader.collect()).resourceMetrics
  const requests = [
    ['traces', 'application/json', JsonTraceSerializer.serializeRequest(memory.getFinishedSpans())],
    ['traces', 'application/x-protobuf', ProtobufTraceSerializer.serializeRequest(memory.getFinishedSpans())],
    ['metrics', 'application/json', JsonMetricsSerializer.serializeRequest(metrics)],
    ['metrics', 'application/x-protobuf', ProtobufMetricsSerializer.serializeRequest(metrics)],
  ]
  for (const runId of ['run-A', 'run-B']) {
    // Reusing source IDs/intervals is deliberate: partitions must remain independent.
    for (const [signal, type, body] of requests) {
      const response = await fetch(`${collector.url}/v1/${signal}`, { method: 'POST', headers: { 'content-type': type, 'content-encoding': 'gzip', 'x-observe-run-id': runId }, body: gzipSync(body) })
      assert.equal(response.status, 200, await response.text())
    }
    await post(`/api/performance/runs/${runId}/finalize`, {})
  }
  assert.equal(await collector.storage.count(), 0)
  assert.equal((await collector.metricStorage.queryMetrics()).total, 0)
  await collector.close()
  collector = await startCollector({ port: 0, capture: new RunCapture(directory) })
  const queryUrl = `${collector.url}/api/performance/runs/run-A/spans`
  const query = await (await fetch(queryUrl)).json()
  assert.equal(query.total, 1)
  assert.equal(query.run.status, 'finalized')
  assert.equal(query.observations[0].events[0].name, 'commit')
  const exportPath = join(temporary, 'frozen-run')
  await capture.exportRun('run-A', exportPath)
  const replay1 = await replayRun(exportPath)
  const replay2 = await replayRun(exportPath)
  assert.deepEqual(replay1.manifest, replay2.manifest)
  assert.deepEqual(replay1.manifest.counts, { requests: 4, bytes: requests.reduce((sum, r) => sum + r[2].length, 0), spans: 1, metricPoints: 1 })
  assert.deepEqual(await replay1.storage.getOperationStats({}), await replay2.storage.getOperationStats({}))
  assert.deepEqual((await replay1.metricStorage.queryMetrics()).points[0].point.bucketCounts, ['1', '1', '1', '1'])
  assert.equal((await fetch(collector.url)).status, 200)
  console.log(JSON.stringify({ status: 'passed', packageRoot: root, url: collector.url, queryUrl, archive: exportPath, counts: replay1.manifest.counts, runs: 2 }))
  serve = process.argv.includes('--serve')
} finally {
  await traceProvider.shutdown()
  await metricProvider.shutdown()
  if (!serve) { await collector.close(); await rm(temporary, { recursive: true, force: true }) }
}
if (serve) {
  const stop = async () => { await collector.close(); await rm(temporary, { recursive: true, force: true }); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
