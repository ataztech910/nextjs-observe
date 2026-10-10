import { describe, expect, it } from 'vitest'
import { validateCheck } from '../src/checks/spec.js'
import { CheckWatch } from '../src/checks/watch.js'
import { questionFor } from '../src/debug/detector.js'
import type { CheckResult as CheckRun, CheckStatus as CheckFacts } from '../src/checks/types.js'
import { agoWords, finishedAtMs, checkQuestion, checkState, everyWords, expectWords, passedWords, sortChecks, summaryWords, traceWorthOpening } from '../ui/src/lib/checks.js'

/** '.' passed, 'x' failed with a 500, '!' reached nobody, 't' timed out. */
function runs(series: string): CheckRun[] {
  return [...series].map((c, i) => ({
    atMs: 1000 + i,
    ok: c === '.',
    durationMs: 20,
    traceId: `${i}`.padStart(32, 'a'),
    ...(c === '!' ? { reason: 'request failed: ECONNREFUSED', unreachable: true as const } : c === 't' ? { reason: 'no answer within 10000 ms' } : { status: c === '.' ? 200 : 500 }),
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
    expect([5, 59, 60, 90, 300, 3597, 3599, 3600, 5400, 86399, 86400, 129600].map(everyWords)).toEqual(['every 5 s', 'every 59 s', 'every 1 min', 'every 1.5 min', 'every 5 min', 'every 1 h', 'every 1 h', 'every 1 h', 'every 1.5 h', 'every 1 d', 'every 1 d', 'every 1.5 d'])
    expect(everyWords(3540)).toBe('every 59 min')
    expect([7.5, 59.94, 59.96].map(everyWords)).toEqual(['every 7.5 s', 'every 59.9 s', 'every 1 min'])
  })

  it('says how long ago without rounding up', () => {
    expect([-5, 0, 999, 59_999, 60_000, 90_000, 3_599_000, 3_600_000, 86_399_000, 86_400_000, 172_800_000].map(agoWords)).toEqual(['0s ago', '0s ago', '0s ago', '59s ago', '1 min ago', '1 min ago', '59 min ago', '1 h ago', '23 h ago', '1 d ago', '2 d ago'])
  })

  it('a run happened when its answer came, not when it was sent', () => {
    expect(finishedAtMs({ atMs: 1000, ok: false, durationMs: 10_000, traceId: 'a' })).toBe(11_000)
    expect(finishedAtMs({ atMs: 1000, ok: true, durationMs: -5, traceId: 'a' })).toBe(1000)
  })

  it('counts the runs that passed', () => {
    expect(passedWords(runs('..x.'))).toBe('3 of 4 runs passed')
    expect(passedWords(runs('x'))).toBe('0 of 1 run passed')
  })
})

describe('summaryWords', () => {
  const all = (...series: string[]) => series.map((x) => facts(x))
  it('all passing only when every check has run and its last run passed', () => {
    expect(summaryWords(all('..', '.'))).toBe('All passing.')
    expect(summaryWords([])).toBe('All passing.')
  })
  it('a check that has not run is waiting, not passing', () => {
    expect(summaryWords(all('', '', '.'))).toBe('2 waiting for their first run — of 3.')
    expect(summaryWords(all(''))).toBe('1 waiting for its first run — of 1.')
  })
  it('one failed run is said, without calling the agents', () => {
    expect(summaryWords(all('..x', '.'))).toBe('1 failed its last run — of 2.')
  })
  it('names what is failing and what the observer does about it', () => {
    expect(summaryWords(all('xx', 'x.x.x.', '.', ''))).toBe('1 failing · 1 unreliable · 1 waiting for its first run — of 4. The AI agents look into a check that fails 2 times in a row, or 3 of its last 10 runs.')
  })
  it('an unreliable check alone is also something the agents are sent to', () => {
    expect(summaryWords(all('x.x.x.', '.'))).toBe('1 unreliable — of 2. The AI agents look into a check that fails 2 times in a row, or 3 of its last 10 runs.')
  })
  it('does not promise an investigation nobody will start', () => {
    expect(summaryWords(all('xx'), undefined, false)).toBe('1 failing — of 1. Nobody is sent to look: the AI agents investigate on their own only with the detector and the chat on.')
  })
  it('follows the rule it is given', () => {
    const strict = { failuresInRow: 1, shareWindow: 4, shareFailures: 2 }
    expect(summaryWords(all('.x'), strict)).toBe('1 failing — of 1. The AI agents look into a check that fails 1 time in a row, or 2 of its last 4 runs.')
    expect(checkQuestion(facts('.x'), strict)).toContain('failed 1 time in a row.')
    expect(checkState(facts('xx.x.x.'), strict)).toBe('unreliable') // two of the last four
    expect(checkState(facts('.....x.x.'))).toBe('passing')
    expect(checkState(facts('xx....'), strict)).toBe('passing') // both left the window of four
    expect(sortChecks([facts('..', { name: 'a' }), facts('.x', { name: 'b' })], strict).map((c) => c.name)).toEqual(['b', 'a'])
  })
})

describe('traceWorthOpening', () => {
  const trace = (series: string) => traceWorthOpening(facts(series))
  it('the latest failure', () => {
    expect(trace('.x.x.')).toMatchObject({ ok: false, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3' })
  })
  it('a timeout has a trace: the request arrived, the app shows where the time went', () => {
    expect(trace('.x.t')).toMatchObject({ reason: 'no answer within 10000 ms', traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3' })
  })
  it('a request that reached nobody has none — and an older failure is not offered in its place', () => {
    expect(trace('.x.!')).toBeUndefined()
    expect(trace('!!')).toBeUndefined()
  })
  it('once the app answers again and the card is green, the latest run is offered', () => {
    expect(trace('.!..')).toMatchObject({ ok: true, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3' })
    expect(trace('!x')).toMatchObject({ ok: false, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' })
  })
  it('an amber card whose failures reached nobody gets no healthy trace in their place', () => {
    expect(checkState(facts('!.!.!.'))).toBe('unreliable')
    expect(trace('!.!.!.')).toBeUndefined()
    // What the card links to and what Investigate asks stay about the same thing.
    expect(checkQuestion(facts('!.!.!.'))).toContain('The request reached nobody, so there is no trace of it')
  })
  it('the latest run when nothing failed lately', () => {
    expect(trace('...')).toMatchObject({ ok: true, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' })
    expect(trace('x..........')).toMatchObject({ ok: true, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa10' }) // the failure left the window
  })
  it('nothing before the first run', () => {
    expect(trace('')).toBeUndefined()
  })
})

describe('checkQuestion', () => {
  it('a check failing in a row', () => {
    expect(checkQuestion(facts('.xx'))).toBe(
      'The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) failed 2 times in a row. Last failure: expected status 2xx, got 500. The app recorded the last failing request as trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2: open it, name the span that failed or took the time and its code file.',
    )
  })
  it('a check failing now and then names the share and the last failure, even when the last run passed', () => {
    const question = checkQuestion(facts('x.x.x.'))
    expect(question).toContain('failed 3 of its last 6 runs. Last failure: expected status 2xx, got 500.')
    expect(question).toContain('trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4')
  })
  it('no answer: no trace to send the agents to', () => {
    const question = checkQuestion(facts('.!!'))
    expect(question).toContain('failed 2 times in a row. Last failure: request failed: ECONNREFUSED. The request reached nobody, so there is no trace of it')
    expect(question).not.toContain('open it')
  })
  it('a timeout sends the agents to the trace', () => {
    expect(checkQuestion(facts('.tt'))).toContain('Last failure: no answer within 10000 ms. No answer came back. If the request arrived, it is trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2: try to open it')
  })
  it('green again after a blip: the blip is a footnote, not "the service gets no traffic"', () => {
    expect(checkQuestion(facts('.!...'))).toBe('The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) is passing now, but failed 1 of its last 5 runs (last: request failed: ECONNREFUSED). Is that worth worrying about?')
    // An answered failure keeps its trace even when the check is green again — the card links to it too.
    expect(checkQuestion(facts('x....'))).toBe(
      'The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) is passing now, but failed 1 of its last 5 runs. Last failure: expected status 2xx, got 500. The app recorded the last failing request as trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0: open it, name the span that failed or took the time and its code file.',
    )
    expect(traceWorthOpening(facts('x....'))?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0')
    expect(checkQuestion(facts('t....'))).toContain('is passing now, but failed 1 of its last 5 runs. Last failure: no answer within 10000 ms. No answer came back. If the request arrived, it is trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0')
    // Unreliable, or the latest run failed: still a failure question.
    expect(checkQuestion(facts('x.x.x.'))).toContain('failed 3 of its last 6 runs. Last failure:')
    expect(checkQuestion(facts('...x'))).toContain('Last failure: expected status 2xx, got 500.')
  })
  it('starts with a capital whatever the shared wording starts with', () => {
    expect(checkQuestion(facts('.xx'))).toMatch(/^The scheduled check /)
  })
  it('one failure is a share of the recent runs, not "in a row"', () => {
    expect(checkQuestion(facts('...x'))).toContain('failed 1 of its last 4 runs.')
  })
  it('counts only the runs the badge is judged on', () => {
    expect(checkQuestion(facts('xxx' + '.'.repeat(9) + 'x'))).toContain('failed 1 of its last 10 runs.')
    expect(checkQuestion(facts('xxx' + '.'.repeat(10)))).toContain('is passing.')
  })
  it('says the same as the anomaly the observer raises on its own', () => {
    const check = validateCheck({ name: 'stock is known', url: '/api/inventory/1' })
    for (const series of ['.xx', 'x..x..x', '.!!', '.tt']) {
      const c = facts(series, { url: '/api/inventory/1' })
      const watch = new CheckWatch()
      let failures = 0
      c.history.forEach((r) => watch.observe(check, r, (failures = r.ok ? 0 : failures + 1)))
      const anomaly = watch.take().at(-1)!
      expect(`Anomaly detected: t${checkQuestion(c).slice(1)}`, series).toBe(questionFor(anomaly))
    }
  })
  it('a passing check can still be asked about', () => {
    expect(checkQuestion(facts('...'))).toBe('The scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) is passing. Is there anything in its recent traces worth worrying about?')
  })
})
