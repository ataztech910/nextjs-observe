import { afterEach, describe, expect, it } from 'vitest'
import { ChatHistory } from '../src/collector/chat-history.js'
import { startCollector, type ChatEvent, type ChatHandler, type Collector } from '../src/collector/index.js'

const step = (n: number): ChatEvent => ({ type: 'step', agent: 'latency_agent', tool: `tool-${n}`, args: {} })
const report: ChatEvent = { type: 'report', text: 'done' }

describe('ChatHistory', () => {
  it('keeps a turn with its events; a report, an error or a stop ends it', () => {
    const history = new ChatHistory()
    history.start({ id: 'q1', question: 'why?', proactive: false, startedAtMs: 10 })
    history.add('q1', step(1))
    expect(history.list()).toEqual([{ id: 'q1', question: 'why?', proactive: false, startedAtMs: 10, events: [step(1)], running: true }])
    history.add('q1', report)
    expect(history.list()[0]).toMatchObject({ running: false, events: [step(1), report] })
    for (const end of [{ type: 'error', message: 'e' }, { type: 'stopped' }] as ChatEvent[]) {
      const h = new ChatHistory()
      h.start({ id: 'x', proactive: true, startedAtMs: 1 })
      h.add('x', end)
      expect(h.list()[0].running).toBe(false)
    }
  })

  it('a turn the observer started has no question; one that nobody will answer is not running', () => {
    const history = new ChatHistory()
    history.start({ id: 'a1', proactive: true, startedAtMs: 5, running: false })
    expect(history.list()).toEqual([{ id: 'a1', proactive: true, startedAtMs: 5, events: [], running: false }])
  })

  it('does not record the same turn twice, and ignores events of a turn it does not know', () => {
    const history = new ChatHistory()
    history.start({ id: 'q1', question: 'first', proactive: false, startedAtMs: 1 })
    history.add('q1', step(1))
    history.start({ id: 'q1', question: 'again', proactive: false, startedAtMs: 2 })
    history.add('gone', step(9))
    history.end('gone')
    expect(history.list()).toEqual([{ id: 'q1', question: 'first', proactive: false, startedAtMs: 1, events: [step(1)], running: true }])
    expect([history.has('q1'), history.has('gone')]).toEqual([true, false])
  })

  it('end() stops a turn that got no closing event', () => {
    const history = new ChatHistory()
    history.start({ id: 'q1', question: 'q', proactive: false, startedAtMs: 1 })
    history.end('q1')
    expect(history.list()[0].running).toBe(false)
  })

  it('forgets the oldest turns past the limit', () => {
    const history = new ChatHistory({ maxTurns: 2 })
    for (const id of ['a', 'b', 'c']) history.start({ id, proactive: true, startedAtMs: 1 })
    expect(history.list().map((t) => t.id)).toEqual(['b', 'c'])
    history.add('a', report) // already forgotten: no ghost comes back
    expect(history.list().map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('a long investigation loses its middle steps, never its end', () => {
    const history = new ChatHistory({ maxEvents: 3 })
    history.start({ id: 'q', question: 'q', proactive: false, startedAtMs: 1 })
    for (let n = 1; n <= 6; n++) history.add('q', step(n))
    history.add('q', report)
    expect(history.list()[0].events).toEqual([step(1), step(2), step(3), report])
    expect(history.list()[0].running).toBe(false)
  })

  it('hands out copies', () => {
    const history = new ChatHistory()
    history.start({ id: 'q', question: 'q', proactive: false, startedAtMs: 1 })
    const [turn] = history.list()
    turn.events.push(report)
    turn.running = false
    expect(history.list()[0]).toMatchObject({ events: [], running: true })
  })
})

describe('GET /api/chat/history', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })
  const ask = (body: object, init: RequestInit = {}) => fetch(`${collector!.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init })
  const history = async () => (await (await fetch(`${collector!.url}/api/chat/history`)).json()) as { seq: number; turns: { id: string; question?: string; proactive: boolean; startedAtMs: number; events: ChatEvent[]; running: boolean }[] }
  const answer: ChatHandler = async (_request, emit) => {
    emit({ type: 'status', mode: 'mock', sessionId: 's1', text: 'Investigating…' })
    emit({ type: 'report', text: 'chargePayment regressed in v2' })
  }

  it('is empty at first, also without agents', async () => {
    collector = await startCollector({ port: 0, uiDir: false })
    expect(await history()).toEqual({ seq: 0, turns: [] })
  })

  it('remembers a question with everything that was answered, under the id the page gave it', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: answer } })
    const before = Date.now()
    await (await ask({ question: '  why is checkout slow?  ', turnId: 'q-123' })).text()
    const { turns, seq } = await history()
    expect(seq).toBe(0) // questions do not go through the event stream
    expect(turns).toEqual([
      {
        id: 'q-123',
        question: 'why is checkout slow?',
        proactive: false,
        startedAtMs: expect.any(Number),
        events: [{ type: 'status', mode: 'mock', sessionId: 's1', text: 'Investigating…' }, { type: 'report', text: 'chargePayment regressed in v2' }],
        running: false,
      },
    ])
    expect(turns[0].startedAtMs).toBeGreaterThanOrEqual(before)
  })

  it('gives a turn an id of its own when the page sent none, or one that is taken', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: answer } })
    await (await ask({ question: 'a' })).text()
    await (await ask({ question: 'b', turnId: 'mine' })).text()
    await (await ask({ question: 'c', turnId: 'mine' })).text()
    const { turns } = await history()
    expect(turns.map((t) => t.question)).toEqual(['a', 'b', 'c'])
    expect(turns[1].id).toBe('mine')
    expect(new Set(turns.map((t) => t.id)).size).toBe(3)
    expect((await ask({ question: 'd', turnId: '../etc' })).status).toBe(400)
    expect((await ask({ question: 'd', turnId: 7 })).status).toBe(400)
    expect((await history()).turns).toHaveLength(3)
  })

  it('a handler that throws leaves a turn that ended in an error', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: async () => Promise.reject(new Error('boom')) } })
    await (await ask({ question: 'q', turnId: 't' })).text()
    expect((await history()).turns[0]).toMatchObject({ events: [{ type: 'error', message: 'boom' }], running: false })
  })

  it('a handler that returns without a closing event still ends the turn', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: async (_request, emit) => emit({ type: 'status', mode: 'mock', sessionId: 's', text: 'Investigating…' }) } })
    await (await ask({ question: 'q', turnId: 't' })).text()
    expect((await history()).turns[0]).toMatchObject({ events: [expect.objectContaining({ type: 'status' })], running: false })
  })

  it('an asker who went away leaves a turn that is no longer running', async () => {
    const handle: ChatHandler = async ({ signal }, emit) => {
      emit({ type: 'status', mode: 'mock', sessionId: 's1', text: 'Investigating…' })
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
      emit({ type: 'stopped', closed: true })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle } })
    const controller = new AbortController()
    const res = await ask({ question: 'q', turnId: 'left' }, { signal: controller.signal })
    await res.body!.getReader().read()
    expect((await history()).turns[0]).toMatchObject({ id: 'left', running: true })
    controller.abort() // the page was reloaded
    for (let i = 0; i < 100 && (await history()).turns[0].running; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await history()).turns[0]).toMatchObject({ running: false, events: [expect.objectContaining({ type: 'status' }), { type: 'stopped', closed: true }] })
  })

  it('remembers the observer\'s own investigations, and says where the event stream continues', async () => {
    const anomaly = {
      id: 'check_failed-1-1', type: 'check_failed' as const, scope: 'operation' as const, severity: 'critical' as const, detectedAtMs: 4242, value: 2, threshold: 2, sampleSize: 2, windowMs: 10_000, operations: [],
      check: { name: 'stock is known', method: 'GET', url: 'http://app/x', rule: 'in_row' as const, reason: 'expected status 2xx, got 500', status: 500, traceId: 'a'.repeat(32) },
    }
    let pending = [anomaly]
    const taken = () => {
      const found = pending
      pending = []
      return found
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: answer }, detectorIntervalMs: 30, checks: { list: () => [], anomalies: taken } })
    for (let i = 0; i < 100 && ((await history()).turns[0]?.running ?? true); i++) await new Promise((r) => setTimeout(r, 10))
    const { seq, turns } = await history()
    expect(seq).toBe(3) // anomaly, status, report
    expect(turns).toEqual([{ id: 'check_failed-1-1', proactive: true, startedAtMs: 4242, events: [expect.objectContaining({ type: 'anomaly' }), expect.objectContaining({ type: 'status' }), { type: 'report', text: 'chargePayment regressed in v2' }], running: false }])
  })

  it('an anomaly with no agents to look into it is remembered as not running', async () => {
    const anomaly = { id: 'no_traffic-1-1', type: 'no_traffic' as const, scope: 'all' as const, severity: 'critical' as const, detectedAtMs: 7, value: 130, threshold: 120, sampleSize: 0, windowMs: 10_000, operations: [] }
    let pending = [anomaly]
    collector = await startCollector({ port: 0, uiDir: false, detectorIntervalMs: 30, checks: { list: () => [], anomalies: () => pending.splice(0) } })
    for (let i = 0; i < 100 && (await history()).turns.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await history()).turns).toEqual([{ id: 'no_traffic-1-1', proactive: true, startedAtMs: 7, events: [expect.objectContaining({ type: 'anomaly' })], running: false }])
  })
})
