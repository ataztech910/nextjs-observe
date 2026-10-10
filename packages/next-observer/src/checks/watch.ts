// When does a failing check become an anomaly the AI agents look into? Not on the first failure — one slow answer
// after a restart, one hiccup of the network — but when it repeats: twice in a row, or often enough lately.
// Pure: fed by the runner's results, asked by the collector; the clock comes with each result.
import type { Anomaly } from '../debug/detector.js'
import type { CheckResult } from './runner.js'
import type { Check } from './spec.js'
import { CHECK_RULE, type CheckRule } from './types.js'
import { originOf } from './words.js'

/** The rule's numbers default to CHECK_RULE: two in a row, or three of the last ten — a check failing every third time never fails twice in a row. */
export interface CheckWatchOptions extends Partial<CheckRule> {
  /** The same check is not reported again within this time. Default 5 min, like the detector. */
  cooldownMs?: number
}

const DEFAULTS = { ...CHECK_RULE, cooldownMs: 300_000 }

export class CheckWatch {
  readonly options: Required<CheckWatchOptions>
  /** The latest runs per check: did it pass, and if not — was there no connection. */
  private readonly recent = new Map<string, ('ok' | 'wrong' | 'no connection')[]>()
  private readonly lastReportedMs = new Map<string, number>()
  /** Failed runs in a row of one kind — no connection, or a wrong answer — per check. */
  private readonly streak = new Map<string, { unreachable: boolean; n: number }>()
  /** Checks whose latest run got no connection, with the address they could not reach. */
  private readonly down = new Map<string, string>()
  private pending: Anomaly[] = []
  private seq = 0

  constructor(options: CheckWatchOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /** The numbers in force — what the Checks page colours by. */
  get rule(): CheckRule {
    const { failuresInRow, shareWindow, shareFailures } = this.options
    return { failuresInRow, shareWindow, shareFailures }
  }

  /** The runner's `onResult`. */
  observe = (check: Check, result: CheckResult, _failures?: number, url: string = check.url): void => {
    const o = this.options
    // Counted here, by kind, and not taken from the runner: after an outage the first slow answer of a restarted app
    // would otherwise be "the fifth failure in a row" — it is the first of its kind.
    const before = this.streak.get(check.name)
    const unreachable = result.unreachable === true
    const failures = result.ok ? 0 : before?.unreachable === unreachable ? before.n + 1 : 1
    this.streak.set(check.name, { unreachable, n: failures })
    const recent = this.recent.get(check.name) ?? []
    recent.push(result.ok ? 'ok' : result.unreachable ? 'no connection' : 'wrong')
    if (recent.length > o.shareWindow) recent.shift()
    this.recent.set(check.name, recent)
    const origin = originOf(url)
    // "Down" by the same rule as an anomaly: one refused connection is a blip, not an outage.
    if (result.unreachable && failures >= o.failuresInRow) this.down.set(check.name, origin)
    else this.down.delete(check.name)
    // Somebody answered at this address: whatever outage was reported is over, the next one is news again.
    if (result.status !== undefined) this.lastReportedMs.delete(addressKey(origin))
    if (result.ok) return

    const failed = recent.filter((run) => run === 'wrong').length
    const inRow = failures >= o.failuresInRow
    // The share rule is about answers that are wrong now and then. A connection refused once is a restart or a blip,
    // and after an outage it would be "3 of the last 10" for every check at once — no connection counts only in a row,
    // and is not counted towards the share either.
    if (!inRow && (failed < o.shareFailures || result.unreachable)) return
    // "No connection" and "a wrong answer" are different problems of one check: the app being down a minute ago must
    // not hide the 500 it gives now that it is back.
    const own = `${check.name}\u0000${result.unreachable ? 'no connection' : 'answer'}`
    const last = this.lastReportedMs.get(own)
    if (last !== undefined && result.atMs - last < o.cooldownMs) return
    // An app that is down fails every check of it the same way: one anomaly says so, the rest would only queue the
    // same investigation again. Checks with other intervals reach the rule later — the address is on cooldown by then.
    const outage = result.unreachable === true
    if (outage) {
      const lastDown = this.lastReportedMs.get(addressKey(origin))
      // The check's own cooldown is left alone: only what was really reported starts one.
      if (lastDown !== undefined && result.atMs - lastDown < o.cooldownMs) return
      this.lastReportedMs.set(addressKey(origin), result.atMs)
    }
    this.lastReportedMs.set(own, result.atMs)

    this.pending.push({
      id: `check_failed-${result.atMs}-${++this.seq}`,
      type: 'check_failed',
      scope: 'operation',
      // In a row: it is down now. Now and then: it is unreliable — worth a look, not an alarm.
      severity: inRow ? 'critical' : 'warning',
      detectedAtMs: result.atMs,
      value: inRow ? failures : failed,
      threshold: inRow ? o.failuresInRow : o.shareFailures,
      sampleSize: inRow ? failures : recent.length,
      windowMs: check.everyMs * (inRow ? failures : recent.length),
      operations: [],
      check: {
        name: check.name,
        method: check.method,
        url,
        rule: inRow ? 'in_row' : 'share',
        reason: result.reason ?? 'failed',
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.unreachable ? { unreachable: true as const } : {}),
        traceId: result.traceId,
        // An outage: take() adds the other checks of this address that are down too.
        ...(outage ? { origin } : {}),
      },
    })
  }

  /** New anomalies since the last call. */
  take(): Anomaly[] {
    const found = this.pending
    this.pending = []
    // Filled in only now: the other checks of a dead app report their own failures a moment after the first one.
    // A check with a longer interval may still be on its last good run — it is then missing from the list.
    for (const { check } of found) {
      if (!check?.origin) continue
      const also = [...this.down].filter(([name, at]) => at === check.origin && name !== check.name).map(([name]) => name)
      if (also.length > 0) check.alsoUnreachable = also
      else delete check.origin
    }
    return found
  }
}

const addressKey = (origin: string) => `\u0000${origin}`
