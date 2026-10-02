// Is a change in error rate between two versions real or noise? A two-proportion z-test — the standard check for
// "did the share change", explainable on a slide: with 30% random failures, 18 requests easily show 22% or 39%.

/** |z| at 95% confidence, two-sided. */
export const Z_95 = 1.96
/** Below this many requests in either version the test is not meaningful — never call it significant. */
export const MIN_REQUESTS = 10

export function errorRateChangeIsSignificant(before: { count: number; errorRate: number }, after: { count: number; errorRate: number }): boolean {
  if (before.count < MIN_REQUESTS || after.count < MIN_REQUESTS) return false
  const errorsBefore = before.errorRate * before.count
  const errorsAfter = after.errorRate * after.count
  const pooled = (errorsBefore + errorsAfter) / (before.count + after.count)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / before.count + 1 / after.count))
  // No variance (both 0% or both 100%) gives 0 / 0 = NaN, and NaN >= Z_95 is false: nothing changed.
  return Math.abs(after.errorRate - before.errorRate) / se >= Z_95
}
