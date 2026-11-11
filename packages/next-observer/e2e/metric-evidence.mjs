// node e2e/metric-evidence.mjs <extracted-package> [--serve]
// Upstream serializer fixtures plus explicit synthetic OTLP exemplars / edge cases, never measured experiment results.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performanceMetrics } from '../test/fixtures/performance-metrics.ts'
import { performanceTrace, TRACE_ID, SPAN_ID } from '../test/fixtures/performance-trace.ts'
const packagePath = process.argv[2]
if (!packagePath) throw Error('Pass extracted package path')
const { startCollector, RunCapture } = await import(pathToFileURL(join(resolve(packagePath), 'dist/collector/index.js')))
const directory = await mkdtemp(join(tmpdir(), 'observe-metric-evidence-'))
const capture = new RunCapture(directory)
const collector = await startCollector({ port: 0, capture })
const stop = async () => { await collector.close(); await rm(directory, { recursive: true, force: true }) }
let serve = false
try {
  const request = async (path, body, runId) => {
    const response = await fetch(collector.url + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...(runId ? { 'x-observe-run-id': runId } : {}) }, body: JSON.stringify(body) } : undefined)
    assert.ok(response.ok, await response.clone().text()); return response.json()
  }
  for (const runId of ['metric-evidence', 'empty-metric-run']) await request('/api/performance/runs', { runId, metadata: { experiment: 'metric-evidence-fixture', variant: 'synthetic', platform: 'otel-fixture' } })
  await request('/v1/traces', performanceTrace().json, 'metric-evidence')
  const body = performanceMetrics().json
  const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics
  const histogram = metrics.find((m) => m.histogram).histogram
  histogram.aggregationTemporality = 2
  const first = histogram.dataPoints[0]
  const exemplar = { timeUnixNano: first.timeUnixNano, asDouble: 0.1, filteredAttributes: [{ key: 'synthetic', value: { boolValue: true } }], traceId: TRACE_ID, spanId: SPAN_ID }
  first.exemplars = [exemplar, { ...exemplar, traceId: 'f'.repeat(32) }, { ...exemplar, spanId: 'e'.repeat(16) }, { ...exemplar, traceId: '', spanId: '' }, { ...exemplar, spanId: '' }]
  const second = { ...structuredClone(first), count: '20', sum: 9.2, bucketCounts: ['4','8','6','2'], exemplars: [] }
  const missing = { ...structuredClone(first), flags: 1, count: '0', bucketCounts: [], explicitBounds: [], exemplars: [] }
  delete missing.min; delete missing.max; delete missing.sum
  const empty = { ...missing, flags: 0, bucketCounts: ['0'] }
  const unbounded = { ...structuredClone(first), count: '1', bucketCounts: ['0','0','0','1'], exemplars: [] }; delete unbounded.max
  const aggregate = { ...structuredClone(first), bucketCounts: [], explicitBounds: [], exemplars: [] }
  const large = { ...structuredClone(empty), count: '9007199254740993', bucketCounts: ['9007199254740993'] }
  histogram.dataPoints = [first, second, missing, empty, unbounded, aggregate, large].map((p, i) => ({ ...p, timeUnixNano: (BigInt(first.timeUnixNano) + BigInt(i) * 1000000000n).toString() }))
  await request('/v1/metrics', body, 'metric-evidence')
  await request('/api/performance/runs/metric-evidence/finalize', {})
  const points = await request('/api/performance/runs/metric-evidence/metrics')
  assert.equal(points.total, 10)
  const histograms = points.observations.filter((m) => m.type === 'histogram')
  assert.equal(histograms.length, 7)
  assert.ok(histograms.some((m) => m.point.count === '9007199254740993'))
  assert.equal(histograms.reduce((n, m) => n + m.point.exemplars.length, 0), 5)
  assert.equal((await request(`/api/performance/runs/metric-evidence/traces/${TRACE_ID}`)).spans[0].spanId, SPAN_ID)
  assert.equal((await fetch(`${collector.url}/api/performance/runs/empty-metric-run/traces/${TRACE_ID}`)).status, 404)
  assert.equal((await fetch(`${collector.url}/api/performance/runs/metric-evidence/traces/${'f'.repeat(32)}`)).status, 404)
  console.log(JSON.stringify({ status: 'passed', url: collector.url, page: `${collector.url}/performance?run=metric-evidence`, synthetic: true, points: points.total, histogramPoints: 7, exemplars: 5 }))
  serve = process.argv.includes('--serve')
} finally { if (!serve) await stop() }
if (serve) { const shutdown = () => stop().then(() => process.exit(0)); process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown) }
