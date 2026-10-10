// When does a failing check become an anomaly the AI agents look into? Not on the first failure — one slow answer
// after a restart, one hiccup of the network — but when it repeats: twice in a row, or often enough lately.
// Pure: fed by the runner's results, asked by the collector; the clock comes with each result.
import type { Anomaly } from '../debug/detector.js'
import type { CheckResult } from './runner.js'
import type { Check } from './spec.js'
import { CHECK_RULE, type CheckRule } from './types.js'

/** The rule's numbers default to CHECK_RULE: two in a row, or three of the last ten — a check failing every third time never fails twice in a row. */
export interface CheckWatchOptions extends Partial<CheckRule> {
  /** The same check is not reported again within this time. Default 5 min, like the detector. */
  cooldownMs?: number
}

const DEFAULTS = { ...CHECK_RULE, cooldownMs: 300_000 }

export class CheckWatch {
  readonly options: Required<CheckWatchOptions>
  private readonly recent = new Map<string, boolean[]>()
  private readonly lastReportedMs = new Map<string, number>()
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
  observe = (check: Check, result: CheckResult, failures: number, url: string = check.url): void => {
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
    const last = this.lastReportedMs.get(check.name)
    if (last !== undefined && result.atMs - last < o.cooldownMs) return
    // An app that is down fails every check of it the same way: one anomaly says so, the rest would only queue the
    // same investigation again. Checks with other intervals reach the rule later — the address is on cooldown by then.
    if (result.unreachable) {
      const key = `\u0000${origin}`
      const lastDown = this.lastReportedMs.get(key)
      // The check's own cooldown is left alone: once the app is back, a failure of its own is news at once.
      if (lastDown !== undefined && result.atMs - lastDown < o.cooldownMs) return
      this.lastReportedMs.set(key, result.atMs)
    }
    this.lastReportedMs.set(check.name, result.atMs)

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
      },
    })
  }

  /** New anomalies since the last call. */
  take(): Anomaly[] {
    const found = this.pending
    this.pending = []
    // Filled in only now: the other checks of a dead app report their own failures a moment after the first one.
    for (const anomaly of found) {
      const c = anomaly.check
      if (!c?.unreachable) continue
      const origin = originOf(c.url)
      const also = [...this.down].filter(([name, at]) => at === origin && name !== c.name).map(([name]) => name)
      if (also.length > 0) Object.assign(c, { origin, alsoUnreachable: also })
    }
    return found
  }
}

/** "http://localhost:3000" of a check's address — what is down when nothing there accepts a connection. */
function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url
}
