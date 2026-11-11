// Build/pack/extract first, then: node e2e/otlp-traces.mjs /path/to/extracted/package [--serve]
// Uses the packed collector/UI and the upstream SDK/exporter, not source-module imports.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { context, createTraceState, SpanKind, trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { JsonTraceSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

if (!process.argv[2]) throw new Error('Pass the extracted npm package directory')
const root = resolve(process.argv[2])
const { startCollector } = await import(pathToFileURL(resolve(root, 'dist/collector/index.js')).href)
const collector = await startCollector({ port: 0 })
const memory = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({ 'service.name': 'performance-smoke', 'service.version': 't1' }),
  spanProcessors: [new SimpleSpanProcessor(memory), new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${collector.url}/v1/traces` }))],
})
let serve = false
try {
  const tracer = provider.getTracer('performance-smoke', '1.2.3')
  const rootSpan = tracer.startSpan('interaction Search', { attributes: { 'experiment.variant': 'degraded' } })
  const child = tracer.startSpan('hook.compute', {
    kind: SpanKind.INTERNAL,
    attributes: { 'observe.perf.phase': 'compute' },
    links: [{ context: { traceId: 'd'.repeat(32), spanId: 'e'.repeat(16), traceFlags: 1, traceState: createTraceState('vendor=shared') }, attributes: { reason: 'shared-work' } }],
  }, trace.setSpan(context.active(), rootSpan))
  child.addEvent('commit', { source: 'smoke-marker' })
  child.end()
  rootSpan.end()
  await provider.forceFlush()
  const spans = memory.getFinishedSpans()
  for (const [serializer, type] of [[JsonTraceSerializer, 'application/json'], [ProtobufTraceSerializer, 'application/x-protobuf']]) {
    const response = await fetch(`${collector.url}/v1/traces`, { method: 'POST', headers: { 'content-type': type }, body: serializer.serializeRequest(spans) })
    assert.equal(response.status, 200)
  }
  const get = async (path) => {
    const response = await fetch(`${collector.url}${path}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await get('/health')).spans, 2)
  const result = await get(`/api/traces/${rootSpan.spanContext().traceId}`)
  assert.equal(result.spans.length, 2)
  assert.deepEqual(result.completeness, { historyComplete: true, missingParentCount: 0 })
  const hook = result.spans.find((s) => s.name === 'hook.compute')
  assert.equal(hook.parentSpanId, rootSpan.spanContext().spanId)
  assert.equal(hook.links[0].traceState, 'vendor=shared')
  assert.equal(hook.otlp.scope.version, '1.2.3')
  assert.equal(hook.otlp.span.events[0].name, 'commit')
  assert.equal(hook.startTimeUnixNano, String(BigInt(child.startTime[0]) * 1_000_000_000n + BigInt(child.startTime[1])))
  assert.equal((await get('/api/operations?operation=hook.compute'))[0].count, 1)
  const invalid = await fetch(`${collector.url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"resourceSpans":null}' })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).code, 3)
  const ui = await fetch(collector.url)
  assert.equal(ui.status, 200)
  assert.match(await ui.text(), /<div id="root">/)
  console.log(JSON.stringify({ status: 'passed', packageRoot: root, url: collector.url, traceUrl: `${collector.url}/traces/${rootSpan.spanContext().traceId}`, spans: 2 }))
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
