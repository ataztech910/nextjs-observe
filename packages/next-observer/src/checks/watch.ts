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
  /**
   * After an anomaly the same check — and, when nothing accepted the connection, the same address — is quiet for this
   * long, whatever happens meanwhile. Default 5 min, like the detector.
   */
  cooldownMs?: number
}

const DEFAULTS = { ...CHECK_RULE, cooldownMs: 300_000 }

export class CheckWatch {
  readonly options: Required<CheckWatchOptions>
  private readonly recent = new Map<string, boolean[]>()
  private readonly lastReportedMs = new Map<string, number>()
  /** When an outage of an address was last reported. */
  private readonly addressReportedMs = new Map<string, number>()
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

  /**
   * The runner's `onResult`; `failures` is its count of failed runs in a row — the same number the Checks page shows.
   * `url` is where the request really went (a check's own `url` may be just a path): the address is taken from it.
   */
  observe = (check: Check, result: CheckResult, failures: number, url: string): void => {
    const o = this.options
    const recent = this.recent.get(check.name) ?? []
    recent.push(result.ok)
    if (recent.length > o.shareWindow) recent.shift()
    this.recent.set(check.name, recent)
    const origin = originOf(url)
    if (result.unreachable) this.down.set(check.name, origin)
    else this.down.delete(check.name)
    if (result.ok) return

    const failed = recent.filter((ok) => !ok).length
    const inRow = failures >= o.failuresInRow
    if (!inRow && failed < o.shareFailures) return
    // A clock set back (NTP, a laptop waking up) must not keep anyone quiet for longer: a negative age is no cooldown.
    const quiet = (last: number | undefined) => last !== undefined && result.atMs >= last && result.atMs - last < o.cooldownMs
    if (quiet(this.lastReportedMs.get(check.name))) return
    // Set even when the address turns out to be quiet below: this failure is part of the outage already reported,
    // and the first slow answer of the restarted app is not worth an anomaly of its own either.
    this.lastReportedMs.set(check.name, result.atMs)
    // No connection, repeatedly: an outage. (A flaky check tipped over its share by one refused connection is not —
    // it must not make the address quiet before the outage itself is reported.)
    const outage = result.unreachable === true && inRow
    if (outage) {
      // An app that is down fails every check of it the same way: one anomaly says so, the rest would only queue the
      // same investigation again. Checks with other intervals reach the rule later — the address is quiet by then.
      if (quiet(this.addressReportedMs.get(origin))) return
      this.addressReportedMs.set(origin, result.atMs)
    }

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
        // No connection, repeatedly: maybe the whole app — take() adds the other checks that cannot reach it either.
        ...(outage ? { origin } : {}),
      },
    })
  }

  /** New anomalies since the last call. */
  take(): Anomaly[] {
    const found = this.pending
    this.pending = []
    // Filled in only now: the other checks of a dead app report their own failures a moment after the first one.
    // A check with a longer interval may still be on its last good run — it is then missing from the list, and quiet
    // about this outage when its turn comes.
    for (const { check } of found) {
      if (!check?.origin) continue
      const also = [...this.down].filter(([name, at]) => at === check.origin && name !== check.name).map(([name]) => name).sort()
      if (also.length > 0) check.alsoUnreachable = also
      else delete check.origin
    }
    return found
  }
}
