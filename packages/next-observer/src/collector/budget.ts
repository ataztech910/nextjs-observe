// How many investigations the observer may start on its own: N per period (OBSERVE_AUTO_INVESTIGATIONS, default 5 per
// 60 min). A budget, not a long queue — an investigation an hour after its anomaly is no use. Questions people ask are
// not counted. Pure: the clock is passed in.
import type { Anomaly } from '../debug/detector.js'

export interface BudgetLimit {
  /** Investigations per period; 0 = the observer never starts one on its own. */
  limit: number
  periodMs: number
}

export const DEFAULT_BUDGET: BudgetLimit = { limit: 5, periodMs: 60 * 60_000 }

/** Investigations waiting behind the running one; more would be stale by the time their turn comes. */
export const MAX_WAITING = 2

export interface BudgetState extends BudgetLimit {
  /** Started within the last period. */
  used: number
  /** When the next one may start, if all are used now; null while there is room (or with a limit of 0: never). */
  nextAtMs: number | null
  /** `used`, per incident type. */
  byType: Partial<Record<Anomaly['type'], number>>
}

export class InvestigationBudget {
  private starts: { atMs: number; type: Anomaly['type'] }[] = []

  readonly options: BudgetLimit

  constructor(options: BudgetLimit = DEFAULT_BUDGET) {
    this.options = options
  }

  /** Takes one for an anomaly of this type; false when the period's budget is spent. */
  take(type: Anomaly['type'], nowMs: number): boolean {
    this.prune(nowMs)
    if (this.starts.length >= this.options.limit) return false
    this.starts.push({ atMs: nowMs, type })
    return true
  }

  state(nowMs: number): BudgetState {
    this.prune(nowMs)
    const byType: BudgetState['byType'] = {}
    for (const s of this.starts) byType[s.type] = (byType[s.type] ?? 0) + 1
    const full = this.starts.length > 0 && this.starts.length >= this.options.limit
    return { ...this.options, used: this.starts.length, nextAtMs: full ? Math.min(...this.starts.map((s) => s.atMs)) + this.options.periodMs : null, byType }
  }

  // A clock set back (NTP, a laptop waking up) must not keep a slot taken for longer: a negative age frees it.
  private prune(nowMs: number) {
    this.starts = this.starts.filter((s) => nowMs >= s.atMs && nowMs - s.atMs < this.options.periodMs)
  }
}

/** OBSERVE_AUTO_INVESTIGATIONS: `5` (per 60 min), `5/30m`, `5/2h`, `0` (off). Unset → the default. */
export function parseBudget(value: string | undefined): BudgetLimit {
  if (value === undefined || value.trim() === '') return DEFAULT_BUDGET
  const match = /^(\d+)(?:\/(\d+)(m|h))?$/.exec(value.trim())
  const periodMs = match?.[2] === undefined ? DEFAULT_BUDGET.periodMs : Number(match[2]) * (match[3] === 'h' ? 3_600_000 : 60_000)
  if (!match || periodMs === 0) throw new Error(`OBSERVE_AUTO_INVESTIGATIONS="${value}": expected a number per period, e.g. 5, 5/30m or 5/2h (0 turns them off)`)
  return { limit: Number(match[1]), periodMs }
}
