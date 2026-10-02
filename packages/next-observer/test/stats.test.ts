import { describe, expect, it } from 'vitest'
import { errorRateChangeIsSignificant } from '../src/debug/stats.js'

describe('errorRateChangeIsSignificant (two-proportion z-test, 95%)', () => {
  it('random 30% failures that "jump" between versions with few requests are noise', () => {
    // The Porto Shop case from step 25: inventory fails ~30% at random, v1 32 requests, v2 18.
    expect(errorRateChangeIsSignificant({ count: 32, errorRate: 0.29 }, { count: 18, errorRate: 0.333 })).toBe(false)
    expect(errorRateChangeIsSignificant({ count: 32, errorRate: 0.29 }, { count: 18, errorRate: 0.44 })).toBe(false)
  })

  it('a real new failure is significant', () => {
    expect(errorRateChangeIsSignificant({ count: 30, errorRate: 0 }, { count: 30, errorRate: 0.3 })).toBe(true)
    // The same +15 points that is noise on 18 requests becomes significant on enough traffic.
    expect(errorRateChangeIsSignificant({ count: 2000, errorRate: 0.29 }, { count: 2000, errorRate: 0.44 })).toBe(true)
  })

  it('never significant with too few requests or no variance', () => {
    expect(errorRateChangeIsSignificant({ count: 9, errorRate: 0 }, { count: 9, errorRate: 1 })).toBe(false)
    expect(errorRateChangeIsSignificant({ count: 50, errorRate: 0 }, { count: 50, errorRate: 0 })).toBe(false)
  })

  it('is symmetric: a real drop is significant too', () => {
    expect(errorRateChangeIsSignificant({ count: 30, errorRate: 0.3 }, { count: 30, errorRate: 0 })).toBe(true)
  })
})
