import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { startCollector, MemoryStorage, type CollectorOptions, type NormalizedSpan } from '../src/collector/index.js'
import { performanceTrace, TRACE_ID, SPAN_ID } from './fixtures/performance-trace.js'

async function withCollector(options: CollectorOptions, run: (url: string) => Promise<void>) {
  const collector = await startCollector({ port: 0, uiDir: false, ...options })
  try { await run(collector.url) } finally { await collector.close() }
}
const post = (url: string, body: unknown) => fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('OTLP trace ingest boundaries', () => {
  it('deduplicates retries and concurrent exports across encodings, including detector input', async () => {
    const seen: NormalizedSpan[] = []
    await withCollector({ detector: { observe: (spans) => void seen.push(...spans), check: () => [] } }, async (url) => {
      const payload = performanceTrace()
      const sendProto = () => fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' }, body: gzipSync(payload.protobuf) })
      const responses = await Promise.all([post(url, payload.json), sendProto(), post(url, payload.json)])
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
      expect(await responses[0].json()).toEqual({})
      expect((await responses[1].arrayBuffer()).byteLength).toBe(0)
      expect(seen).toHaveLength(1)
      expect((await (await fetch(`${url}/health`)).json()).spans).toBe(1)
      const result = await (await fetch(`${url}/api/traces/${TRACE_ID}`)).json()
      expect(result.spans).toHaveLength(1)
      expect(result.spans[0]).toMatchObject({ spanId: SPAN_ID, startTimeUnixNano: '1800000000123456789', links: [{ traceId: 'd'.repeat(32) }] })
      expect(result.completeness).toEqual({ historyComplete: true, missingParentCount: 1 })
      const stats = await (await fetch(`${url}/api/operations?operation=hook.compute`)).json()
      expect(stats[0].count).toBe(1)
    })
  })

  it('rejects mixed valid/invalid batches atomically with JSON Status, not 500', async () => {
    const storage = new MemoryStorage()
    await withCollector({ storage }, async (url) => {
      for (const invalid of [null, [], { resourceSpans: {} }]) {
        const r = await post(url, invalid)
        expect(r.status).toBe(400)
        expect(await r.json()).toMatchObject({ code: 3, message: expect.any(String) })
      }
      const payload = performanceTrace().json
      const spans = payload.resourceSpans![0].scopeSpans![0].spans!
      spans.push({ ...spans[0], spanId: '0'.repeat(16) })
      const result = await post(url, payload)
      expect(result.status).toBe(400)
      expect(await storage.count()).toBe(0)
    })
  })

  it('rejects malformed UTF-8 rather than replacing invalid input characters', async () => {
    await withCollector({}, async (url) => {
      const json = JSON.stringify(performanceTrace().json).replace('hook.compute', 'UNSAFE')
      const bytes = Buffer.concat([Buffer.from(json.split('UNSAFE')[0]), Buffer.from([0xff]), Buffer.from(json.split('UNSAFE')[1])])
      const r = await fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes })
      expect(r.status).toBe(400)
    })
  })

  it('returns protobuf google.rpc.Status on malformed protobuf and authentication failures', async () => {
    await withCollector({}, async (url) => {
      const r = await fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: Buffer.from([0]) })
      expect(r.status).toBe(400)
      expect(r.headers.get('content-type')).toBe('application/x-protobuf')
      const bytes = new Uint8Array(await r.arrayBuffer())
      // Independent wire assertions: Status.code=3, Status.message follows (UTF-8 string).
      expect([...bytes.slice(0, 3)]).toEqual([8, 3, 18])
      expect(new TextDecoder().decode(bytes)).toContain('valid OTLP protobuf')
    })
    await withCollector({ apiKey: 'required' }, async (url) => {
      const r = await fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: Buffer.alloc(0) })
      expect(r.status).toBe(401)
      expect([...new Uint8Array(await r.arrayBuffer()).slice(0, 3)]).toEqual([8, 16, 18])
    })
  })

  it('enforces configured limits in both encodings and keeps query responses compatible', async () => {
    await withCollector({ traceLimits: { maxDepth: 2 } }, async (url) => {
      const payload = performanceTrace()
      expect((await post(url, payload.json)).status).toBe(400)
      const r = await fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: Buffer.from(payload.protobuf) })
      expect(r.status).toBe(400)
      expect((await (await fetch(`${url}/api/services`)).json())).toEqual([])
    })
    await withCollector({ storage: new MemoryStorage({ maxSpans: 1 }) }, async (url) => {
      const p = performanceTrace().json
      expect((await post(url, p)).status).toBe(200)
      const s = p.resourceSpans![0].scopeSpans![0].spans![0]
      s.spanId = 'f'.repeat(16)
      expect((await post(url, p)).status).toBe(200)
      const result = await (await fetch(`${url}/api/traces/${TRACE_ID}`)).json()
      expect(result.completeness.historyComplete).toBe(false)
      expect(result.spans[0].spanId).toBe('f'.repeat(16))
      expect(Array.isArray(await (await fetch(`${url}/api/traces`)).json())).toBe(true)
    })
  })

  it('still accepts a span-only third-party StorageAdapter without the optional insert capability', async () => {
    const storage = new MemoryStorage()
    const legacy = {
      insertSpans: storage.insertSpans.bind(storage), queryTraces: storage.queryTraces.bind(storage),
      getTrace: storage.getTrace.bind(storage), getOperationStats: storage.getOperationStats.bind(storage),
      querySpans: storage.querySpans.bind(storage), getServices: storage.getServices.bind(storage), count: storage.count.bind(storage),
      isColdStart: storage.isColdStart.bind(storage), isHistoryComplete: storage.isHistoryComplete.bind(storage),
    }
    await withCollector({ storage: legacy }, async (url) => {
      expect((await post(url, performanceTrace().json)).status).toBe(200)
      expect(await storage.count()).toBe(1)
    })
  })
})
