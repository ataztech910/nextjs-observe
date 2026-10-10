import { describe, expect, it } from 'vitest'
import type { CheckResult } from '../src/checks/runner.js'
import { validateCheck } from '../src/checks/spec.js'
import { CheckWatch } from '../src/checks/watch.js'
import { questionFor } from '../src/debug/detector.js'

const check = validateCheck({ name: 'stock is known', url: '/api/inventory/1', everySeconds: 30 })
const URL_ = 'http://localhost:3000/api/inventory/1'
const T0 = 1_760_000_000_000

/** Feeds a series of runs ('.' ok, 'x' failed), one per interval, the way the runner does; returns what each run raised. */
function feed(watch: CheckWatch, series: string, opts: { from?: number; result?: Partial<CheckResult>; streak?: number } = {}) {
  let failures = opts.streak ?? 0
  return [...series].map((c, i) => {
    const ok = c === '.'
    failures = ok ? 0 : failures + 1
    const result: CheckResult = { atMs: (opts.from ?? T0) + i * 30_000, ok, durationMs: 20, status: ok ? 200 : 500, traceId: `${i}`.padStart(32, 'a'), ...(ok ? {} : { reason: 'expected status 2xx, got 500' }), ...opts.result }
    watch.observe(check, result, failures, URL_)
    return watch.take()
  })
}
const raised = (out: ReturnType<typeof feed>) => out.map((a) => a.length).join('')

describe('CheckWatch: when a failing check becomes an anomaly', () => {
  it('not on the first failure, on the second in a row', () => {
    const out = feed(new CheckWatch(), '..x.xx')
    expect(raised(out)).toBe('000001')
    expect(out[5][0]).toEqual({
      id: expect.stringMatching(/^check_failed-\d+-1$/),
      type: 'check_failed',
      scope: 'operation',
      severity: 'critical',
      detectedAtMs: T0 + 5 * 30_000,
      value: 2,
      threshold: 2,
      sampleSize: 2,
      windowMs: 60_000,
      operations: [],
      check: { name: 'stock is known', method: 'GET', url: URL_, rule: 'in_row', reason: 'expected status 2xx, got 500', status: 500, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5' },
    })
  })

  it('a check that fails now and then, never twice in a row, is caught by its share', () => {
    const out = feed(new CheckWatch(), 'x..x..x')
    expect(raised(out)).toBe('0000001')
    expect(out[6][0]).toMatchObject({ severity: 'warning', value: 3, threshold: 3, sampleSize: 7, windowMs: 210_000, check: { rule: 'share' } })
  })

  it('the share looks only at the latest ten runs', () => {
    // Failures at runs 1, 6, 11, 16: never three within ten.
    expect(raised(feed(new CheckWatch(), 'x....x....x....x'))).toBe('0000000000000000')
    expect(raised(feed(new CheckWatch(), 'x...x...x'))).toBe('000000001')
  })

  it('a passing run never raises anything, however bad the history', () => {
    const watch = new CheckWatch({ cooldownMs: 0 })
    expect(raised(feed(watch, 'xxx.'))).toBe('0110')
  })

  it('reports the same check once per cooldown, and again after it', () => {
    const watch = new CheckWatch()
    expect(raised(feed(watch, 'xxxxxxxxxx'))).toBe('0100000000') // 4.5 min of failing: one report
    expect(raised(feed(watch, 'xx', { from: T0 + 300_000, streak: 10 }))).toBe('01') // 5 min after the report at 30 s
  })

  it('keeps checks apart', () => {
    const watch = new CheckWatch()
    const other = validateCheck({ name: 'home', url: '/' })
    const failed = (at: number): CheckResult => ({ atMs: at, ok: false, durationMs: 5, traceId: 'b'.repeat(32), reason: 'request failed: ECONNREFUSED' })
    watch.observe(check, failed(T0), 1, URL_)
    watch.observe(other, failed(T0), 1)
    expect(watch.take()).toEqual([])
    watch.observe(check, failed(T0 + 1), 2, URL_)
    watch.observe(other, failed(T0 + 1), 2)
    const found = watch.take()
    expect(found.map((a) => [a.check?.name, a.check?.url])).toEqual([['stock is known', URL_], ['home', '/']])
    expect(found[0].id).not.toBe(found[1].id)
    expect('status' in found[0].check!).toBe(false)
    expect(watch.take()).toEqual([])
  })

  it('thresholds can be changed', () => {
    expect(raised(feed(new CheckWatch({ failuresInRow: 3, shareFailures: 99 }), 'xxx'))).toBe('001')
    expect(raised(feed(new CheckWatch({ failuresInRow: 99, shareFailures: 2, shareWindow: 3 }), 'x..x.x'))).toBe('000001')
  })
})

describe('CheckWatch: an app that is down is one anomaly, not one per check', () => {
  const APP = 'http://localhost:3000'
  const checks = ['/a', '/b', '/c'].map((url, i) => validateCheck({ name: `check ${i + 1}`, url, everySeconds: 30 }))
  const partner = validateCheck({ name: 'partner', url: 'https://partner.example/health' })
  const refused = (atMs: number): CheckResult => ({ atMs, ok: false, durationMs: 2, traceId: 'c'.repeat(32), reason: 'request failed: ECONNREFUSED', unreachable: true })
  const failed500 = (atMs: number): CheckResult => ({ atMs, ok: false, durationMs: 2, status: 500, traceId: 'd'.repeat(32), reason: 'expected status 2xx, got 500' })
  const passed = (atMs: number): CheckResult => ({ atMs, ok: true, durationMs: 2, status: 200, traceId: 'e'.repeat(32) })
  /** Every check of the app gets the same result, one round after another. */
  const rounds = (watch: CheckWatch, n: number, result: (atMs: number) => CheckResult, from = T0, streak = 0) => {
    for (let round = 0; round < n; round++) for (const check of checks) watch.observe(check, result(from + round * 30_000), streak + round + 1, `${APP}${check.url}`)
  }

  it('reports the first check and names the others', () => {
    const watch = new CheckWatch()
    rounds(watch, 2, refused)
    const found = watch.take()
    expect(found).toHaveLength(1)
    expect(found[0].check).toMatchObject({ name: 'check 1', unreachable: true, origin: APP, alsoUnreachable: ['check 2', 'check 3'] })
    expect(questionFor(found[0])).toContain('The request reached nobody, so there is no trace of it — check whether the service is receiving any traffic at all. 2 other checks get no connection either (check 2, check 3): http://localhost:3000 looks down as a whole, not one route.')
  })

  it('stays quiet about the address for the cooldown, then says it again', () => {
    const watch = new CheckWatch()
    rounds(watch, 9, refused)
    expect(watch.take()).toHaveLength(1)
    rounds(watch, 2, refused, T0 + 300_000, 9)
    expect(watch.take().map((a) => a.check?.name)).toEqual(['check 1'])
  })

  it('checks that fail with an answer are still each their own anomaly', () => {
    const watch = new CheckWatch()
    rounds(watch, 2, failed500)
    const found = watch.take()
    expect(found.map((a) => a.check?.name)).toEqual(['check 1', 'check 2', 'check 3'])
    expect(found.every((a) => !('alsoUnreachable' in a.check!))).toBe(true)
  })

  it('a check that got an answer is not told about its neighbours without a connection', () => {
    const watch = new CheckWatch()
    for (const atMs of [T0, T0 + 30_000]) {
      const n = atMs === T0 ? 1 : 2
      watch.observe(checks[0], failed500(atMs), n, `${APP}/a`)
      watch.observe(checks[1], refused(atMs), n, `${APP}/b`)
      watch.observe(checks[2], refused(atMs), n, `${APP}/c`)
    }
    expect(watch.take().map((a) => [a.check?.name, a.check?.alsoUnreachable])).toEqual([['check 1', undefined], ['check 2', ['check 3']]])
  })

  it('another address is another matter', () => {
    const watch = new CheckWatch()
    rounds(watch, 2, refused)
    watch.observe(partner, refused(T0), 1)
    watch.observe(partner, refused(T0 + 30_000), 2)
    const found = watch.take()
    expect(found.map((a) => [a.check?.name, a.check?.alsoUnreachable])).toEqual([['check 1', ['check 2', 'check 3']], ['partner', undefined]])
  })

  it('a single check without a connection is told as before', () => {
    const watch = new CheckWatch()
    watch.observe(checks[0], refused(T0), 1, `${APP}/a`)
    watch.observe(checks[0], refused(T0 + 1), 2, `${APP}/a`)
    const [anomaly] = watch.take()
    expect('alsoUnreachable' in anomaly.check!).toBe(false)
    expect('origin' in anomaly.check!).toBe(false)
    expect(questionFor(anomaly)).not.toContain('looks down as a whole')
  })

  it('a neighbour refused only once is not yet counted as down', () => {
    const watch = new CheckWatch()
    for (const check of checks) watch.observe(check, refused(T0), 1, `${APP}${check.url}`)
    watch.observe(checks[1], passed(T0 + 10_000), 0, `${APP}/b`) // the app answered for a moment
    watch.observe(checks[1], refused(T0 + 20_000), 1, `${APP}/b`) // refused again, but only once in a row
    watch.observe(checks[0], refused(T0 + 30_000), 2, `${APP}/a`)
    watch.observe(checks[2], refused(T0 + 30_000), 2, `${APP}/c`)
    expect(watch.take().map((a) => [a.check?.name, a.check?.alsoUnreachable])).toEqual([['check 1', ['check 3']]])
  })

  it('a check that answers again is no longer counted among the unreachable', () => {
    const watch = new CheckWatch()
    for (const check of checks) watch.observe(check, refused(T0), 1, `${APP}${check.url}`)
    watch.observe(checks[2], passed(T0 + 10), 0, `${APP}/c`) // came back
    for (const check of checks.slice(0, 2)) watch.observe(check, refused(T0 + 30_000), 2, `${APP}${check.url}`)
    expect(watch.take()[0].check).toMatchObject({ name: 'check 1', alsoUnreachable: ['check 2'] })
    expect(questionFor((() => { const w = new CheckWatch(); rounds(w, 2, refused); const a = w.take()[0]; a.check!.alsoUnreachable = ['check 2']; return a })())).toContain('Another check gets no connection either (check 2): http://localhost:3000 looks down')
  })

  it('a second outage after the app came back is news again, even within the cooldown', () => {
    const watch = new CheckWatch()
    rounds(watch, 2, refused)
    expect(watch.take()).toHaveLength(1)
    rounds(watch, 1, passed, T0 + 60_000) // back
    expect(watch.take()).toEqual([])
    rounds(watch, 2, refused, T0 + 120_000) // down again, 2 minutes after the first report
    const found = watch.take()
    // Check 1 already said "no connection" two minutes ago; the next one to break the rule says it for this outage.
    expect(found.map((a) => [a.check?.name, a.check?.alsoUnreachable])).toEqual([['check 2', ['check 1', 'check 3']]])
  })

  it('one refused round is a blip, not an outage — even when it would tip a flaky check over its share', () => {
    const watch = new CheckWatch()
    watch.observe(checks[0], failed500(T0), 1, `${APP}/a`)
    watch.observe(checks[0], passed(T0 + 1), 0, `${APP}/a`)
    watch.observe(checks[0], failed500(T0 + 2), 1, `${APP}/a`)
    watch.observe(checks[0], passed(T0 + 3), 0, `${APP}/a`)
    rounds(watch, 1, refused, T0 + 30_000) // e.g. next dev restarting
    expect(watch.take()).toEqual([])
    // The next wrong answer is the third failure of ten: now it is said, and as what it is.
    watch.observe(checks[0], failed500(T0 + 60_000), 1, `${APP}/a`)
    const found = watch.take()
    expect(found.map((a) => [a.check?.name, a.severity, a.check?.rule, a.check?.reason])).toEqual([['check 1', 'warning', 'share', 'expected status 2xx, got 500']])
    expect('origin' in found[0].check!).toBe(false)
  })

  it('the check that reported the outage is not silenced about its own wrong answers afterwards', () => {
    const watch = new CheckWatch()
    rounds(watch, 2, refused)
    expect(watch.take().map((a) => a.check?.name)).toEqual(['check 1'])
    watch.observe(checks[0], failed500(T0 + 60_000), 3, `${APP}/a`)
    watch.observe(checks[0], failed500(T0 + 90_000), 4, `${APP}/a`)
    expect(watch.take().map((a) => [a.check?.name, a.check?.reason])).toEqual([['check 1', 'expected status 2xx, got 500']])
    // And the same kind of failure again stays on its cooldown.
    watch.observe(checks[0], failed500(T0 + 120_000), 5, `${APP}/a`)
    expect(watch.take()).toEqual([])
  })

  it('the first slow answer of a restarted app is not "the fifth failure in a row"', () => {
    // Seen on the real shop: four refused connections, then the cold start broke the time limit once.
    const watch = new CheckWatch()
    const slow = (atMs: number): CheckResult => ({ atMs, ok: false, durationMs: 423, status: 200, traceId: 'f'.repeat(32), reason: 'took 423 ms, limit 300 ms' })
    rounds(watch, 4, refused)
    expect(watch.take()).toHaveLength(1)
    watch.observe(checks[0], slow(T0 + 150_000), 5, `${APP}/a`) // the runner's own count says 5
    expect(watch.take()).toEqual([])
    watch.observe(checks[0], passed(T0 + 180_000), 0, `${APP}/a`)
    watch.observe(checks[0], slow(T0 + 210_000), 1, `${APP}/a`)
    expect(watch.take()).toEqual([]) // two wrong answers in ten, the refused ones do not count towards the share
    watch.observe(checks[0], slow(T0 + 240_000), 2, `${APP}/a`)
    expect(watch.take().map((a) => [a.check?.rule, a.value, a.check?.reason])).toEqual([['in_row', 2, 'took 423 ms, limit 300 ms']])
  })

  it('an answered failure of the same check is reported even while the address is on cooldown', () => {
    const watch = new CheckWatch({ cooldownMs: 300_000 })
    rounds(watch, 2, refused)
    watch.take()
    // The app is back but check 2 now gets a 500, twice: a different problem, said at once.
    watch.observe(checks[1], failed500(T0 + 60_000), 3, `${APP}/b`)
    expect(watch.take()).toEqual([]) // the first wrong answer: not yet
    watch.observe(checks[1], failed500(T0 + 90_000), 4, `${APP}/b`)
    expect(watch.take().map((a) => [a.check?.name, a.check?.reason, a.value])).toEqual([['check 2', 'expected status 2xx, got 500', 2]])
  })
})

describe('questionFor a failing check', () => {
  const anomaly = (series: string, result?: Partial<CheckResult>) => feed(new CheckWatch(), series, { result }).flat()[0]

  it('names the check, the rule, the reason and the trace to open', () => {
    expect(questionFor(anomaly('xx'))).toBe(
      'Anomaly detected: the scheduled check "stock is known" (GET http://localhost:3000/api/inventory/1) failed 2 times in a row. Last failure: expected status 2xx, got 500. The app recorded the last failing request as trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1: open it, name the span that failed or took the time and its code file.',
    )
  })

  it('says how often for a check that fails now and then', () => {
    expect(questionFor(anomaly('x..x..x'))).toContain('failed 3 of its last 7 runs. Last failure: expected status 2xx, got 500.')
  })

  it('does not send the agents after a trace that cannot exist', () => {
    const question = questionFor(anomaly('xx', { status: undefined, reason: 'request failed: ECONNREFUSED', unreachable: true }))
    expect(question).toContain('Last failure: request failed: ECONNREFUSED. The request reached nobody, so there is no trace of it')
    expect(question).not.toContain('open it')
  })

  it('a timeout: nobody knows whether the request arrived — the trace is worth a try, and its absence is an answer too', () => {
    const question = questionFor(anomaly('xx', { status: undefined, reason: 'no answer within 10000 ms' }))
    expect(question).toContain('Last failure: no answer within 10000 ms. No answer came back. If the request arrived, it is trace aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1: try to open it and name the span where it got stuck. If there is no such trace, the request never arrived or the app is stuck')
    expect(question).not.toContain('The app recorded')
  })

  it('reports the rule in force', () => {
    expect(new CheckWatch().rule).toEqual({ failuresInRow: 2, shareWindow: 10, shareFailures: 3 })
    expect(new CheckWatch({ failuresInRow: 4, cooldownMs: 1 }).rule).toEqual({ failuresInRow: 4, shareWindow: 10, shareFailures: 3 })
  })
})
