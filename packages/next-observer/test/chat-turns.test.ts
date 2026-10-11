import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../src/collector/index.js'
import type { Anomaly } from '../src/debug/detector.js'
import type { StoredTurn } from '../src/collector/chat-history.js'
import { applyProactive, followedElsewhere, investigations, shownTurn, summarize, withHistory, type Turn } from '../ui/src/lib/chat-turns.js'

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

  it('takes the observer\'s word for what is still running — the page that asked may be another tab', () => {
    const turns = withHistory([], stored, headline)
    expect(turns.map((t) => t.running)).toEqual([false, true, true])
    expect(summarize(turns[2]).state).toBe('running')
  })

  it('a question asked elsewhere is followed by asking again: its copy here is replaced, nothing else is', () => {
    const first = withHistory([], stored, headline)
    const mine = question('q-mine', 400, [step], true)
    const later: StoredTurn[] = [
      { ...stored[0], events: [] }, // not followed: must stay as it is on the page
      stored[1],
      { ...stored[2], events: [step, step, { type: 'report', text: 'done elsewhere' }], running: false },
      { id: 'q-mine', question: 'stale copy', proactive: false, startedAtMs: 400, events: [], running: false },
    ]
    const turns = withHistory([...first, mine], later, headline, new Set(['q-2']))
    expect(turns.map((t) => t.id)).toEqual(['q-1', 'a-1', 'q-2', 'q-mine'])
    expect(turns[0].events).toHaveLength(2)
    expect(turns[2]).toMatchObject({ running: false, events: [step, step, { type: 'report', text: 'done elsewhere' }] })
    expect(turns[3]).toBe(mine)
    // A followed turn the observer has forgotten meanwhile stays as it was.
    expect(withHistory(first, [], headline, new Set(['q-2']))[2]).toBe(first[2])
  })

  it('a question that turns up in a later answer is followed from then on — it does not freeze at its first sight', () => {
    const followed = new Set<string>()
    // What the page does with every answer of the observer: mark what is not its own, then merge.
    const take = (turns: Turn[], answer: StoredTurn[]) => {
      for (const s of answer) if (!s.proactive) followed.add(s.id)
      return withHistory(turns, answer, headline, followed)
    }
    const late: StoredTurn = { id: 'q-late', question: 'asked in another tab, after this page loaded', proactive: false, startedAtMs: 900, events: [step], running: true }
    let turns = take([], stored.slice(0, 1))
    turns = take(turns, [stored[0], late])
    expect(turns.find((t) => t.id === 'q-late')).toMatchObject({ running: true, events: [step] })
    expect(followedElsewhere(turns, followed)).toBe(true)
    turns = take(turns, [stored[0], { ...late, events: [step, { type: 'report', text: 'done' }], running: false }])
    expect(turns.find((t) => t.id === 'q-late')).toMatchObject({ running: false, events: [step, { type: 'report', text: 'done' }] })
    expect(followedElsewhere(turns, followed)).toBe(false)
  })

  it('knows when there is still a question being answered elsewhere', () => {
    const turns = withHistory([], stored, headline)
    expect(followedElsewhere(turns, new Set(['q-1', 'q-2']))).toBe(true)
    expect(followedElsewhere(turns, new Set(['q-1']))).toBe(false) // answered
    expect(followedElsewhere(turns, new Set(['a-1']))).toBe(false) // the observer's own: the event stream covers it
    expect(followedElsewhere(turns, new Set())).toBe(false)
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
