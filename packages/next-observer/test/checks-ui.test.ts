import { describe, expect, it } from 'vitest'
import { validateCheck } from '../src/checks/spec.js'
import { CheckWatch } from '../src/checks/watch.js'
import { checkQuestion, checkState, everyWords, expectWords, passedWords, sortChecks, traceWorthOpening, type CheckFacts, type CheckRun } from '../ui/src/lib/checks.js'

/** '.' passed, 'x' failed with a 500, '!' nothing answered. */
function runs(series: string): CheckRun[] {
  return [...series].map((c, i) => ({
    atMs: 1000 + i,
    ok: c === '.',
    durationMs: 20,
    traceId: `${i}`.padStart(32, 'a'),
    ...(c === '!' ? { reason: 'request failed: ECONNREFUSED' } : { status: c === '.' ? 200 : 500 }),
    ...(c === 'x' ? { reason: 'expected status 2xx, got 500' } : {}),
  }))
}
function facts(series: string, extra: Partial<CheckFacts> = {}): CheckFacts {
  const history = runs(series)
  let failures = 0
  for (let i = history.length - 1; i >= 0 && !history[i].ok; i--) failures++
  return { name: 'stock is known', method: 'GET', url: 'http://localhost:3000/api/inventory/1', everySeconds: 60, expect: {}, failures, history, ...(history.length ? { last: history.at(-1) } : {}), ...extra }
}

describe('checkState', () => {
  it.each([
    ['', 'waiting'],
    ['.', 'passing'],
    ['x', 'passing'], // one failure is not a state yet
    ['.x.', 'passing'],
    ['xx', 'failing'],
    ['....xx', 'failing'],
    ['x.x.x.', 'unreliable'],
    ['x..x..x', 'unreliable'],
    ['xxx..........', 'passing'], // the failures left the window of ten
    ['xx.', 'passing'],
  ])('%s → %s', (series, state) => {
    expect(checkState(facts(series))).toBe(state)
  })

  it('agrees with the rule that sends the AI agents: red or amber exactly when an anomaly was raised', () => {
    const check = validateCheck({ name: 'a', url: '/a' })
    for (const series of ['xx', '.xx', 'x..x..x', 'x.x.x', '.x.', 'x', '..x..x..', 'x....x....x']) {
      const watch = new CheckWatch({ cooldownMs: 0 })
      let failures = 0
      let raised = 0
      runs(series).forEach((r) => {
        failures = r.ok ? 0 : failures + 1
        watch.observe(check, r, failures)
        raised = watch.take().length
      })
      // The watch judges a run when it fails; the page judges the state now — they agree whenever the last run failed.
      expect([series, checkState(facts(series)) !== 'passing'], series).toEqual([series, raised > 0])
    }
  })
})

describe('sortChecks', () => {
  it('worst first, the file order within a state', () => {
    const list = [facts('..', { name: 'a' }), facts('', { name: 'b' }), facts('x.x.x', { name: 'c' }), facts('xx', { name: 'd' }), facts('.', { name: 'e' }), facts('xxx', { name: 'f' })]
    expect(sortChecks(list).map((c) => c.name)).toEqual(['d', 'f', 'c', 'a', 'e', 'b'])
    expect(list.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

describe('words', () => {
  it('says what a good answer is', () => {
    expect(expectWords({})).toBe('any 2xx')
    expect(expectWords({ status: [200] })).toBe('status 200')
    expect(expectWords({ status: [401, 403], maxMs: 300, bodyIncludes: 'Porto "Shop"' })).toBe('status 401 or 403 · within 300 ms · contains "Porto \\"Shop\\""')
    expect(expectWords({ maxMs: 500 })).toBe('any 2xx · within 500 ms')
  })

  it('says how often', () => {
    expect([5, 59, 60, 90, 300, 3600, 5400, 86400].map(everyWords)).toEqual(['every 5 s', 'every 59 s', 'every 1 min', 'every 1.5 min', 'every 5 min', 'every 1 h', 'every 1.5 h', 'every 24 h'])
  })

  it('counts the runs that passed', () => {
    expect(passedWords(runs('..x.'))).toBe('3 of 4 runs passed')
    expect(passedWords(runs('x'))).toBe('0 of 1 run passed')
  })
})

describe('traceWorthOpening', () => {
  it('the latest failure that got an answer', () => {
    expect(traceWorthOpening(runs('.x.x.'))?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3')
  })
  it('a failure without an answer has no trace — the latest answered failure before it', () => {
    expect(traceWorthOpening(runs('.x.!'))?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')
  })
  it('the latest run when nothing failed', () => {
    expect(traceWorthOpening(runs('...'))).toMatchObject({ ok: true, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' })
  })
  it('nothing when nothing ever answered', () => {
    expect(traceWorthOpening(runs('!!'))).toBeUndefined()
    expect(traceWorthOpening([])).toBeUndefined()
  })
})

describe('checkQuestion', () => {
  it('a check failing in a row', () => {
    expect(checkQuestion(facts('.xx'))).toBe(
      'The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) has failed 2 times in a row. Last failure: expected status 2xx, got 500. The app recorded the last failing request as trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2: open it, name the span that failed or took the time and its code file.',
    )
  })
  it('a check failing now and then names the share and the last failure, even when the last run passed', () => {
    const question = checkQuestion(facts('x.x.x.'))
    expect(question).toContain('failed 3 of its last 6 runs. Last failure: expected status 2xx, got 500.')
    expect(question).toContain('trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4')
  })
  it('no answer: no trace to send the agents to', () => {
    const question = checkQuestion(facts('.!!'))
    expect(question).toContain('has failed 2 times in a row. Last failure: request failed: ECONNREFUSED. No answer came back')
    expect(question).not.toContain('open it')
  })
  it('a passing check can still be asked about', () => {
    expect(checkQuestion(facts('...'))).toBe('The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) is passing. Is there anything in its recent traces worth worrying about?')
  })
})
