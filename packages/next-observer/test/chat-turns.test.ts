import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../src/collector/index.js'
import type { Anomaly } from '../src/debug/detector.js'
import type { StoredTurn } from '../src/collector/chat-history.js'
import { applyProactive, investigations, notedText, shownTurn, summarize, withHistory, type Turn } from '../ui/src/lib/chat-turns.js'

const anomaly = (severity: Anomaly['severity'], detectedAtMs: number): Anomaly => ({
  id: 'a', type: 'high_latency', scope: 'all', severity, detectedAtMs, value: 0.4, threshold: 0.3, sampleSize: 10, windowMs: 10_000, operations: [],
})
const options = { chatEnabled: true, headline: (a: Anomaly) => `Slow · ${a.severity}`, nowMs: 5000 }
const feed = (events: ChatEvent[], turnId = 't1', start: Turn[] = [], opts = options) => events.reduce((turns, event) => applyProactive(turns, { turnId, event }, opts), start)
const status: ChatEvent = { type: 'status', mode: 'mock', sessionId: 's', text: 'Investigating…' }
const step: ChatEvent = { type: 'step', agent: 'latency_agent', tool: 'compare_versions', args: {} }
const question = (id: string, startedAtMs: number, events: ChatEvent[] = [], running = false): Turn => ({ id, question: `q ${id}`, events, running, startedAtMs })

describe('applyProactive', () => {
  it('an anomaly starts a turn named by its headline, dated by when it was detected', () => {
    const turns = feed([{ type: 'anomaly', anomaly: anomaly('critical', 1234) }])
    expect(turns).toEqual([{ id: 't1', question: 'Slow · critical', events: [expect.objectContaining({ type: 'anomaly' })], running: true, proactive: true, startedAtMs: 1234 }])
  })

  it('later events join the same turn; a report ends it', () => {
    const turns = feed([{ type: 'anomaly', anomaly: anomaly('warning', 1) }, status, step, { type: 'report', text: 'done' }])
    expect(turns).toHaveLength(1)
    expect(turns[0].events.map((e) => e.type)).toEqual(['anomaly', 'status', 'step', 'report'])
    expect(turns[0].running).toBe(false)
  })

  it.each([[{ type: 'error', message: 'boom' }], [{ type: 'stopped' }]] as [ChatEvent][])('%j ends it too', (end) => {
    expect(feed([{ type: 'anomaly', anomaly: anomaly('warning', 1) }, end])[0].running).toBe(false)
  })

  it('an ended turn stays ended, whatever comes after', () => {
    const turns = feed([{ type: 'anomaly', anomaly: anomaly('warning', 1) }, { type: 'stopped' }, step])
    expect(turns[0].running).toBe(false)
    expect(turns[0].events).toHaveLength(3)
  })

  it('without agents an anomaly is just noted — nothing is running', () => {
    const turns = feed([{ type: 'anomaly', anomaly: anomaly('warning', 1) }], 't1', [], { ...options, chatEnabled: false })
    expect(turns[0].running).toBe(false)
    expect(summarize(turns[0]).state).toBe('noted')
  })

  it('keeps turns apart, in the order they started, and leaves the others untouched', () => {
    const mine = question('q-1', 10)
    const turns = feed([{ type: 'anomaly', anomaly: anomaly('warning', 20) }], 't2', feed([{ type: 'anomaly', anomaly: anomaly('critical', 5) }], 't1', [mine]))
    expect(turns.map((t) => t.id)).toEqual(['q-1', 't1', 't2'])
    expect(turns[0]).toBe(mine)
  })

  it('a turn whose first event is not an anomaly still gets a name and a time', () => {
    expect(feed([status])[0]).toMatchObject({ question: 'Anomaly', startedAtMs: 5000 })
  })
})

describe('summarize', () => {
  it.each([
    [[] as ChatEvent[], true, 'running'],
    [[step], true, 'running'],
    [[step, { type: 'report', text: 'r' }], false, 'answered'],
    [[step, { type: 'stopped' }], false, 'stopped'],
    [[{ type: 'error', message: 'e' }], false, 'failed'],
    [[step], false, 'noted'],
    [[{ type: 'stopped' }, { type: 'error', message: 'late' }], false, 'stopped'], // what the user did wins over what came after
  ] as [ChatEvent[], boolean, string][])('%j running=%s → %s', (events, running, state) => {
    expect(summarize(question('q', 1, events, running)).state).toBe(state)
  })

  it('a question has no severity; an anomaly carries its own', () => {
    expect(summarize(question('q', 7))).toEqual({ id: 'q', title: 'q q', kind: 'question', state: 'noted', startedAtMs: 7 })
    const [turn] = feed([{ type: 'anomaly', anomaly: anomaly('critical', 9) }, { type: 'report', text: 'r' }])
    expect(summarize(turn)).toEqual({ id: 't1', title: 'Slow · critical', kind: 'anomaly', state: 'answered', severity: 'critical', startedAtMs: 9 })
  })
})

describe('the list and the turn on screen', () => {
  const turns = [question('old', 100), question('new', 300), question('middle', 200)]

  it('lists the newest first', () => {
    expect(investigations(turns).map((t) => t.id)).toEqual(['new', 'middle', 'old'])
    expect(turns.map((t) => t.id)).toEqual(['old', 'new', 'middle'])
  })

  it('shows the one picked, else the latest', () => {
    expect(shownTurn(turns, 'old')?.id).toBe('old')
    expect(shownTurn(turns, null)?.id).toBe('new')
    expect(shownTurn(turns, 'gone')?.id).toBe('new')
    expect(shownTurn([], null)).toBeUndefined()
  })
})

describe('withHistory: a page that was just opened', () => {
  const headline = (a: Anomaly) => `Slow · ${a.severity}`
  const stored: StoredTurn[] = [
    { id: 'q-1', question: 'why is checkout slow?', proactive: false, startedAtMs: 100, events: [step, { type: 'report', text: 'r' }], running: false },
    { id: 'a-1', proactive: true, startedAtMs: 200, events: [{ type: 'anomaly', anomaly: anomaly('critical', 200) }, step], running: true },
    { id: 'q-2', question: 'left in the middle', proactive: false, startedAtMs: 300, events: [step], running: true },
  ]

  it('brings back questions and the observer\'s own investigations', () => {
    const turns = withHistory([], stored, headline)
    expect(turns.map((t) => [t.id, t.question, t.proactive ?? false])).toEqual([
      ['q-1', 'why is checkout slow?', false],
      ['a-1', 'Slow · critical', true],
      ['q-2', 'left in the middle', false],
    ])
    expect(summarize(turns[0]).state).toBe('answered')
  })

  it('an investigation of the observer\'s own may still be running; a question from a page that is gone is not', () => {
    const turns = withHistory([], stored, headline)
    expect(turns.map((t) => t.running)).toEqual([false, true, false])
    expect(summarize(turns[2]).state).toBe('noted')
  })

  it('turns already on the page win over their stored copies, and come after the restored ones', () => {
    const mine = question('q-2', 300, [step, step], true)
    const turns = withHistory([mine], stored, headline)
    expect(turns.map((t) => t.id)).toEqual(['q-1', 'a-1', 'q-2'])
    expect(turns[2]).toBe(mine)
  })

  it('a stored turn without an anomaly event still gets a name', () => {
    expect(withHistory([], [{ id: 'x', proactive: true, startedAtMs: 1, events: [], running: false }], headline)[0].question).toBe('Anomaly')
  })
})

describe('notedText: why an anomaly was not investigated', () => {
  const budget = { limit: 5, periodMs: 3_600_000, used: 5, nextAtMs: 42, byType: {} }
  const time = (ms: number) => `t${ms}`
  it('names the budget and when the next one may start, or the queue, or that they are off', () => {
    expect(notedText({ type: 'noted', reason: 'budget', budget }, time)).toBe('not investigated: 5 of 5 investigations on their own used in the last 60 min, next at t42 — ask in the chat to look into it')
    expect(notedText({ type: 'noted', reason: 'budget', budget: { ...budget, limit: 1, used: 1 } }, time)).toContain('1 of 1 investigation on their own')
    expect(notedText({ type: 'noted', reason: 'queue', budget }, time)).toBe('not investigated: enough investigations are already waiting — ask in the chat to look into it')
    expect(notedText({ type: 'noted', reason: 'budget', budget: { ...budget, limit: 0, used: 0, nextAtMs: null } }, time)).toContain('only when asked (OBSERVE_AUTO_INVESTIGATIONS=0)')
  })

  it('a noted anomaly ends its turn and is listed as noted', () => {
    const anomaly = { id: 'x', type: 'high_error_rate', scope: 'app', severity: 'warning', detectedAtMs: 1, value: 1, threshold: 1, sampleSize: 1, windowMs: 1, operations: [] } as unknown as Anomaly
    const opts = { chatEnabled: true, headline: () => 'errors', nowMs: 1 }
    let turns = applyProactive([], { turnId: 'x', event: { type: 'anomaly', anomaly } }, opts)
    expect(turns[0].running).toBe(true)
    turns = applyProactive(turns, { turnId: 'x', event: { type: 'noted', reason: 'budget', budget } }, opts)
    expect(turns[0].running).toBe(false)
    expect(summarize(turns[0]).state).toBe('noted')
  })
})
