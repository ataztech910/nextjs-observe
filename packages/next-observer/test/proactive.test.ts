import { afterEach, describe, expect, it } from 'vitest'
import { startCollector, type ChatHandler, type Collector, type ProactiveEvent } from '../src/collector/index.js'
import { AnomalyDetector } from '../src/debug/detector.js'

let collector: Collector | undefined
afterEach(async () => {
  await collector?.close()
  collector = undefined
})

let seq = 0
// OTLP/JSON server spans, like @vercel/otel sends them: kind 2 = SERVER, status code 2 = ERROR.
function requests(n: number, name: string, opts: { error?: boolean; durationMs?: number } = {}) {
  const start = BigInt(Date.now()) * 1_000_000n
  return Array.from({ length: n }, () => {
    seq++
    return {
      traceId: seq.toString(16).padStart(32, '0'),
      spanId: seq.toString(16).padStart(16, '0'),
      name,
      kind: 2,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + BigInt((opts.durationMs ?? 40) * 1_000_000)),
      status: { code: opts.error ? 2 : 0 },
    }
  })
}
const ingest = (spans: object[]) =>
  fetch(`${collector!.url}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'shop' } }] }, scopeSpans: [{ spans }] }] }),
  })

// Minimal SSE reader: collects `data:` envelopes until `until` is satisfied or time runs out.
async function listen(until: (events: ProactiveEvent[]) => boolean, timeoutMs = 4000) {
  const res = await fetch(`${collector!.url}/api/chat/events`)
  expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
  const reader = res.body!.getReader()
  const events: ProactiveEvent[] = []
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  while (!until(events) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))])
    if (!chunk || chunk.done) break
    buffer += new TextDecoder().decode(chunk.value)
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)))
  }
  await reader.cancel()
  return events
}
const types = (events: ProactiveEvent[]) => events.map((e) => e.event.type)

describe('proactive investigations', () => {
  it('a check that keeps failing → anomaly over SSE and an investigation, with or without the detector', async () => {
    const anomaly = {
      id: 'check_failed-1-1', type: 'check_failed' as const, scope: 'operation' as const, severity: 'critical' as const, detectedAtMs: 1, value: 2, threshold: 2, sampleSize: 2, windowMs: 10_000, operations: [],
      check: { name: 'stock is known', method: 'GET', url: 'http://app/api/inventory/1', rule: 'in_row' as const, reason: 'expected status 2xx, got 500', status: 500, traceId: 'a'.repeat(32) },
    }
    for (const detector of [undefined, new AnomalyDetector()]) {
      const asked: string[] = []
      const handle: ChatHandler = async ({ question }, emit) => {
        asked.push(question)
        emit({ type: 'report', text: 'checkInventory throws' })
      }
      let pending = [anomaly]
      const taken = () => {
        const found = pending
        pending = []
        return found
      }
      collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle }, detector, detectorIntervalMs: 50, checks: { list: () => [], anomalies: taken } })
      const events = await listen((e) => types(e).includes('report'))
      expect(types(events)).toEqual(['anomaly', 'report'])
      expect(events[0]).toMatchObject({ turnId: 'check_failed-1-1', event: { type: 'anomaly', anomaly: { check: { name: 'stock is known' } } } })
      expect(asked).toEqual([expect.stringContaining('the scheduled check "stock is known" (GET http://app/api/inventory/1) failed 2 times in a row')])
      await collector.close()
      collector = undefined
    }
  })

  it('failing traffic → anomaly pushed over SSE, then the agents investigate in the same turn', async () => {
    const asked: string[] = []
    const handle: ChatHandler = async ({ question }, emit) => {
      asked.push(question)
      emit({ type: 'status', mode: 'mock', sessionId: 's1', text: 'Investigating…' })
      emit({ type: 'report', text: 'inventory.check is failing' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle }, detector: new AnomalyDetector(), detectorIntervalMs: 100 })
    const listening = listen((events) => types(events).includes('report'))
    await ingest([...requests(6, 'GET /api/products'), ...requests(4, 'GET /api/inventory/[id]', { error: true })])
    const events = await listening

    expect(types(events)).toEqual(['anomaly', 'status', 'report'])
    expect(new Set(events.map((e) => e.turnId)).size).toBe(1)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events[0].event).toMatchObject({ type: 'anomaly', anomaly: { type: 'high_error_rate', value: 0.4 } })
    expect(asked[0]).toContain('40% of server requests failed')
    expect(asked[0]).toContain('GET /api/inventory/[id]')
  })

  it('without agents: the anomaly is still shown', async () => {
    collector = await startCollector({ port: 0, uiDir: false, detector: new AnomalyDetector(), detectorIntervalMs: 100 })
    const listening = listen((events) => events.length > 0)
    await ingest(requests(10, 'POST /api/checkout', { durationMs: 2400 }))
    expect(types(await listening)).toEqual(['anomaly'])
  })

  it('replays recent proactive events to a tab opened later', async () => {
    collector = await startCollector({ port: 0, uiDir: false, detector: new AnomalyDetector(), detectorIntervalMs: 50 })
    await ingest(requests(10, 'GET /x', { error: true }))
    await new Promise((r) => setTimeout(r, 300))
    const late = await listen((events) => events.length > 0, 1000)
    expect(late[0].event).toMatchObject({ type: 'anomaly', anomaly: { type: 'high_error_rate' } })
  })

  it('runs investigations one at a time when anomalies fire together', async () => {
    let running = 0
    let maxRunning = 0
    const handle: ChatHandler = async (_request, emit) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 150))
      running--
      emit({ type: 'report', text: 'done' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle }, detector: new AnomalyDetector(), detectorIntervalMs: 100 })
    const listening = listen((events) => types(events).filter((t) => t === 'report').length === 2)
    // errors and slowness at once → two anomalies in one check
    await ingest(requests(10, 'POST /api/checkout', { error: true, durationMs: 2400 }))
    const events = await listening
    expect(types(events).filter((t) => t === 'anomaly')).toHaveLength(2)
    expect(types(events).filter((t) => t === 'report')).toHaveLength(2)
    expect(maxRunning).toBe(1)
  })

  it('survives an investigation that keeps emitting after the collector closed', async () => {
    let emitLater!: () => void
    const handle: ChatHandler = async (_request, emit) => {
      await new Promise<void>((resolve) => (emitLater = resolve))
      emit({ type: 'report', text: 'too late' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle }, detector: new AnomalyDetector(), detectorIntervalMs: 50 })
    // a tab that stays connected until the collector itself closes
    const tab = await fetch(`${collector.url}/api/chat/events`)
    const reader = tab.body!.getReader()
    reader.read().catch(() => {})
    await ingest(requests(10, 'GET /x', { error: true }))
    await new Promise((r) => setTimeout(r, 300)) // anomaly fired, investigation waiting
    const errors: unknown[] = []
    const onError = (error: unknown) => errors.push(error)
    process.on('uncaughtException', onError)
    try {
      const closing = collector.close()
      emitLater() // the investigation resumes while the collector shuts down
      await closing
      collector = undefined
      await new Promise((r) => setTimeout(r, 100))
      expect(errors).toEqual([])
    } finally {
      process.off('uncaughtException', onError)
      reader.cancel().catch(() => {})
    }
  })

  it('sends nothing on healthy traffic', async () => {
    collector = await startCollector({ port: 0, uiDir: false, detector: new AnomalyDetector(), detectorIntervalMs: 50 })
    const listening = listen(() => false, 600)
    await ingest(requests(20, 'GET /'))
    expect(await listening).toEqual([])
  })
})
