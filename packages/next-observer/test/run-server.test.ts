import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunCapture, startCollector, MemoryStorage, MemoryMetricStorage, type CollectorOptions } from '../src/collector/index.js'
import { parseCliArgs } from '../src/cli.js'
import { performanceTrace } from './fixtures/performance-trace.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const metadata = { experiment: 'A', variant: 'baseline', platform: 'react-web' }
async function start(options: CollectorOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'observe-run-http-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const capture = new RunCapture(directory)
  const collector = await startCollector({ port: 0, uiDir: false, capture, ...options })
  cleanup.push(() => collector.close())
  return { ...collector, capture }
}
const basic = { authorization: `Basic ${Buffer.from('u:viewer').toString('base64')}` }
const jsonPost = (url: string, path: string, body: unknown, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('run capture HTTP boundary', () => {
  it('captures JSON/protobuf/gzip runs without contaminating live storage or detector, survives bounded live eviction', async () => {
    const detector = { observe: vi.fn(), check: () => [] }
    const collector = await start({ storage: new MemoryStorage({ maxSpans: 1 }), metricStorage: new MemoryMetricStorage(1), detector })
    const { url } = collector
    expect((await jsonPost(url, '/api/performance/runs', { runId: 'A', metadata })).status).toBe(201)
    const headers = { 'x-observe-run-id': 'A' }
    expect((await jsonPost(url, '/v1/traces', performanceTrace().json, headers)).status).toBe(200)
    const protobuf = await fetch(`${url}/v1/metrics`, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' }, body: gzipSync(performanceMetrics().protobuf) })
    expect(protobuf.status).toBe(200)
    expect((await protobuf.arrayBuffer()).byteLength).toBe(0)
    expect(await collector.storage.count()).toBe(0)
    expect((await collector.metricStorage!.queryMetrics()).total).toBe(0)
    expect(detector.observe).not.toHaveBeenCalled()
    await jsonPost(url, '/v1/traces', performanceTrace().json)
    await jsonPost(url, '/v1/metrics', performanceMetrics().json)
    expect(detector.observe).toHaveBeenCalledOnce()
    expect((await collector.metricStorage!.queryMetrics()).historyComplete).toBe(false)
    const finalize = await jsonPost(url, '/api/performance/runs/A/finalize', {})
    expect(await finalize.json()).toMatchObject({ status: 'finalized', counts: { spans: 1, metricPoints: 4 } })
    const first = await (await fetch(`${url}/api/performance/runs/A/metrics?limit=2`)).json()
    expect(first).toMatchObject({ total: 4, nextOffset: 2, truncated: true, run: { status: 'finalized', incompleteReasons: [] } })
    const second = await (await fetch(`${url}/api/performance/runs/A/metrics?limit=2&offset=2`)).json()
    expect(second).toMatchObject({ total: 4, nextOffset: null, observations: expect.any(Array) })
    expect(second.observations).toHaveLength(2)
    expect((await (await fetch(`${url}/api/performance/runs`)).json()).runs[0]).not.toHaveProperty('records')
    const where = encodeURIComponent(JSON.stringify([{ target: 'resource', key: 'service.name', value: { stringValue: 'performance-fixture' } }]))
    expect((await (await fetch(`${url}/api/performance/runs/A/spans?where=${where}`)).json()).total).toBe(1)
  })

  it('protects run management/query by UI auth and ingest by API key; never silently falls back for an unknown run', async () => {
    const { url } = await start({ apiKey: 'ingest', uiPassword: 'viewer' })
    expect((await jsonPost(url, '/api/performance/runs', { runId: 'A', metadata })).status).toBe(401)
    expect((await jsonPost(url, '/api/performance/runs', { runId: 'A', metadata }, basic)).status).toBe(201)
    expect((await jsonPost(url, '/v1/traces', performanceTrace().json, { 'x-observe-run-id': 'A' })).status).toBe(401)
    expect((await jsonPost(url, '/v1/traces', performanceTrace().json, { 'x-observe-run-id': 'A', 'x-api-key': 'ingest' })).status).toBe(200)
    expect((await jsonPost(url, '/v1/traces', performanceTrace().json, { 'x-observe-run-id': 'missing', 'x-api-key': 'ingest' })).status).toBe(404)
    expect((await fetch(`${url}/api/performance/runs/A/spans`)).status).toBe(401)
    expect((await jsonPost(url, '/api/performance/runs/A/finalize', {})).status).toBe(401)
    expect((await fetch(`${url}/api/performance/runs`, { headers: basic })).status).toBe(200)
  })

  it('applies protocol limits before capture and returns explicit disabled/frozen/errors without writes', async () => {
    const { url, capture } = await start({ traceLimits: { maxSpans: 0 } })
    await capture.create('A', metadata)
    expect((await jsonPost(url, '/v1/traces', performanceTrace().json, { 'x-observe-run-id': 'A' })).status).toBe(400)
    expect((await capture.read('A')).manifest.counts.requests).toBe(0)
    for (const path of ['/api/performance/runs/A/spans?where=oops', '/api/performance/runs/A/metrics?limit=0', '/api/performance/runs/A/spans?offset=Infinity']) expect((await fetch(`${url}${path}`)).status).toBe(400)
    expect((await jsonPost(url, '/api/performance/runs', null)).status).toBe(400)
    expect((await jsonPost(url, '/api/performance/runs', { runId: '../x', metadata })).status).toBe(400)
    await capture.finalize('A')
    expect((await jsonPost(url, '/v1/metrics', performanceMetrics().json, { 'x-observe-run-id': 'A' })).status).toBe(409)
    const disabled = await startCollector({ port: 0, uiDir: false })
    cleanup.push(() => disabled.close())
    expect((await fetch(`${disabled.url}/api/performance/runs`)).status).toBe(503)
    expect((await jsonPost(disabled.url, '/v1/traces', performanceTrace().json, { 'x-observe-run-id': 'A' })).status).toBe(503)
    expect(await disabled.storage.count()).toBe(0)
  })

  it('advertises opt-in capability and parses the local directory without changing default CLI options', async () => {
    const { url } = await start()
    expect(await (await fetch(`${url}/api/performance/capabilities`)).json()).toMatchObject({ runs: { schema: 'next-observe/run/v1', capture: true } })
    expect(parseCliArgs(['collector', '--capture-dir', './runs'], {}, '/tmp/work')).toMatchObject({ captureDir: '/tmp/work/runs' })
    expect(parseCliArgs(['collector'], { OBSERVE_CAPTURE_DIR: './from-env' }, '/tmp/work')).toMatchObject({ captureDir: '/tmp/work/from-env' })
    expect(parseCliArgs(['collector'], {}, '/tmp/work')).not.toHaveProperty('captureDir')
  })
})
