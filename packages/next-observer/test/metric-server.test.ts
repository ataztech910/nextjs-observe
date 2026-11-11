import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { startCollector, type CollectorOptions } from '../src/collector/index.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'
import { MemoryMetricStorage } from '../src/collector/metric-storage.js'

async function withCollector(options: CollectorOptions, run: (url: string) => Promise<void>) {
  const server = await startCollector({ port: 0, uiDir: false, ...options })
  try { await run(server.url) } finally { await server.close() }
}
const post = (url: string, body: unknown, key?: string) => fetch(`${url}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: JSON.stringify(body) })

describe('OTLP metrics receiver', () => {
  it('receives official JSON/protobuf/gzip and deduplicates concurrent retries, independently of span storage', async () => {
    await withCollector({}, async (url) => {
      const payload = performanceMetrics()
      const protobuf = () => fetch(`${url}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' }, body: gzipSync(payload.protobuf) })
      const results = await Promise.all([post(url, payload.json), protobuf(), post(url, payload.json)])
      expect(results.map((r) => r.status)).toEqual([200, 200, 200])
      expect(await results[0].json()).toEqual({})
      expect(results[1].headers.get('content-type')).toBe('application/x-protobuf')
      expect((await results[1].arrayBuffer()).byteLength).toBe(0)
      const data = await (await fetch(`${url}/api/performance/metrics?service=metric-fixture`)).json()
      expect(data).toMatchObject({ total: 4, truncated: false, historyComplete: true, quantileMethod: 'explicit-bucket-linear-interpolation' })
      expect(data.points.find((p: { name: string }) => p.name === 'interaction.duration')).toMatchObject({ type: 'histogram', point: { bucketCounts: ['2', '4', '3', '1'] }, quantiles: { p50: { lowerBound: 0.1, upperBound: 0.5, approximate: true } } })
      const selected = await (await fetch(`${url}/api/performance/metrics?name=calls&limit=1`)).json()
      expect(selected.total).toBe(1)
      expect(selected.points[0].point.asInt).toBe('7')
      expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok', spans: 0 })
    })
  })

  it('separates ingestion x-api-key from UI/query Basic auth', async () => {
    await withCollector({ apiKey: 'ingest', uiPassword: 'viewer' }, async (url) => {
      expect((await post(url, performanceMetrics().json)).status).toBe(401)
      expect((await post(url, performanceMetrics().json, 'ingest')).status).toBe(200)
      expect((await fetch(`${url}/api/performance/metrics`)).status).toBe(401)
      expect((await fetch(`${url}/api/performance/capabilities`)).status).toBe(401)
      const allowed = await fetch(`${url}/api/performance/capabilities`, { headers: { authorization: `Basic ${Buffer.from('u:viewer').toString('base64')}` } })
      expect(await allowed.json()).toEqual({ metrics: true, metricTypes: ['sum', 'gauge', 'histogram'] })
    })
  })

  it('rejects invalid mixed batches, unsupported types and conflicts without partial insertion', async () => {
    await withCollector({}, async (url) => {
      const p = performanceMetrics().json
      p.resourceMetrics[0].scopeMetrics[0].metrics.push({ name: 'unsupported', exponentialHistogram: {} })
      const unsupported = await post(url, p)
      expect(unsupported.status).toBe(400)
      expect(await unsupported.json()).toMatchObject({ code: 3, message: expect.stringContaining('unsupported') })
      expect((await (await fetch(`${url}/api/performance/metrics`)).json()).total).toBe(0)
      const good = performanceMetrics().json
      expect((await post(url, good)).status).toBe(200)
      good.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt = '999'
      const conflict = await post(url, good)
      expect(conflict.status).toBe(400)
      expect(await conflict.json()).toMatchObject({ code: 3, message: expect.stringContaining('conflicting') })
      expect((await (await fetch(`${url}/api/performance/metrics?name=calls`)).json()).points[0].point.asInt).toBe('7')
    })
  })

  it('answers malformed protobuf with binary Status and applies body/decoded limits to metrics', async () => {
    await withCollector({ metricLimits: { maxPoints: 3 } }, async (url) => {
      expect((await post(url, performanceMetrics().json)).status).toBe(400)
      const res = await fetch(`${url}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: Buffer.from([0]) })
      expect(res.status).toBe(400)
      expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)]).toEqual([8, 3, 18])
      expect((await fetch(`${url}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    })
    await withCollector({ maxBodyBytes: 200 }, async (url) => {
      const p = gzipSync(Buffer.from(JSON.stringify(performanceMetrics().json)))
      expect((await fetch(`${url}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: p })).status).toBe(413)
    })
  })

  it('exposes eviction/pagination, disabled capabilities and invalid queries explicitly', async () => {
    await withCollector({ metricStorage: new MemoryMetricStorage(3) }, async (url) => {
      await post(url, performanceMetrics().json)
      const page = await (await fetch(`${url}/api/performance/metrics?limit=1`)).json()
      expect(page).toMatchObject({ total: 3, truncated: true, historyComplete: false })
      for (const query of ['limit=0', 'limit=Infinity', 'limit=1.5', 'offset=-1', 'fromMs=Infinity', 'fromMs=2&toMs=1']) expect((await fetch(`${url}/api/performance/metrics?${query}`)).status).toBe(400)
    })
    await withCollector({ metricStorage: false }, async (url) => {
      expect((await post(url, {})).status).toBe(503)
      expect((await fetch(`${url}/api/performance/metrics`)).status).toBe(503)
      expect(await (await fetch(`${url}/api/performance/capabilities`)).json()).toEqual({ metrics: false, metricTypes: [] })
    })
  })
})
