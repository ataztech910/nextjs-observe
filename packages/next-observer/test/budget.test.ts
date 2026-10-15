import { describe, expect, it } from 'vitest'
import { DEFAULT_BUDGET, InvestigationBudget, parseBudget } from '../src/collector/budget.js'

const HOUR = 3_600_000

describe('investigation budget', () => {
  it('gives N per period, then says when the next one may start', () => {
    const budget = new InvestigationBudget({ limit: 2, periodMs: HOUR })
    expect(budget.take('high_error_rate', 1000)).toBe(true)
    expect(budget.state(1000)).toEqual({ limit: 2, periodMs: HOUR, used: 1, nextAtMs: null, byType: { high_error_rate: 1 } })
    expect(budget.take('check_failed', 2000)).toBe(true)
    expect(budget.take('high_error_rate', 3000)).toBe(false)
    expect(budget.state(3000)).toEqual({ limit: 2, periodMs: HOUR, used: 2, nextAtMs: 1000 + HOUR, byType: { high_error_rate: 1, check_failed: 1 } })
    // The oldest frees up one period after it started, not after the last one.
    expect(budget.take('no_traffic', 1000 + HOUR - 1)).toBe(false)
    expect(budget.take('no_traffic', 1000 + HOUR)).toBe(true)
    expect(budget.state(1000 + HOUR).byType).toEqual({ check_failed: 1, no_traffic: 1 })
  })

  it('a limit of 0 never starts one and names no time', () => {
    const budget = new InvestigationBudget({ limit: 0, periodMs: HOUR })
    expect(budget.take('high_latency', 1)).toBe(false)
    expect(budget.state(1)).toMatchObject({ used: 0, nextAtMs: null })
  })

  it('a clock set back frees the slots instead of keeping them taken', () => {
    const budget = new InvestigationBudget({ limit: 1, periodMs: HOUR })
    expect(budget.take('high_latency', 10 * HOUR)).toBe(true)
    expect(budget.take('high_latency', 9 * HOUR)).toBe(true)
  })

  it('reads OBSERVE_AUTO_INVESTIGATIONS', () => {
    expect(parseBudget(undefined)).toEqual(DEFAULT_BUDGET)
    expect(parseBudget(' ')).toEqual(DEFAULT_BUDGET)
    expect(DEFAULT_BUDGET).toEqual({ limit: 5, periodMs: HOUR })
    expect(parseBudget('3')).toEqual({ limit: 3, periodMs: HOUR })
    expect(parseBudget('0')).toEqual({ limit: 0, periodMs: HOUR })
    expect(parseBudget('10/30m')).toEqual({ limit: 10, periodMs: 30 * 60_000 })
    expect(parseBudget('5/2h')).toEqual({ limit: 5, periodMs: 2 * HOUR })
    for (const bad of ['five', '-1', '5/0m', '5/30', '5/30s', '2.5']) expect(() => parseBudget(bad), bad).toThrow(/OBSERVE_AUTO_INVESTIGATIONS/)
  })
})
