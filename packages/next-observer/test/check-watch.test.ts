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
    const question = questionFor(anomaly('xx', { status: undefined, reason: 'request failed: ECONNREFUSED' }))
    expect(question).toContain('Last failure: request failed: ECONNREFUSED. No answer came back, so there is no trace of this request')
    expect(question).not.toContain('open it')
  })
})
