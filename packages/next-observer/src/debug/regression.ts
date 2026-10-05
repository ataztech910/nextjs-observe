// "v2 looks like a regression" — the one deploy-to-deploy change worth a banner, picked from compareVersions().
// Plain rules, no model: the banner states measured numbers; explaining them is the agents' job (the Investigate button).
import type { AgentQueries } from './queries.js'

export type VersionChange = Awaited<ReturnType<AgentQueries['compareVersions']>>['changes'][number]

export interface RegressionOptions {
  /** p95 must grow at least this many times… Default 2. */
  minP95Ratio?: number
  /** …and by at least this much: 2 ms → 6 ms is ×3 and nobody's problem. Default 100. */
  minP95IncreaseMs?: number
  /** Error rate must grow by at least this (and pass the significance test). Default 0.1. */
  minErrorRateDelta?: number
  /** Requests needed on each side before any claim. Default 5. */
  minCount?: number
}

export interface Regression {
  service: string
  /** The version that looks worse, and the one it is compared with. */
  version: string
  previousVersion: string
  operation: string
  kind: 'latency' | 'errors'
  from: { count: number; p95Ms: number; errorRate: number }
  to: { count: number; p95Ms: number; errorRate: number }
  p95Ratio: number | null
  errorRateDelta: number
  /** Ready to send to the agents. */
  question: string
}

// "GET /api/products": a request as the user sees it. A banner names the route; the function inside it is the diagnosis.
const isRoute = (operation: string) => /^[A-Z]+ \//.test(operation)

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`)
const pct = (n: number) => `${Math.round(n * 100)}%`

export function findRegression(changes: VersionChange[], options: RegressionOptions = {}): Regression | null {
  const minP95Ratio = options.minP95Ratio ?? 2
  const minP95IncreaseMs = options.minP95IncreaseMs ?? 100
  const minErrorRateDelta = options.minErrorRateDelta ?? 0.1
  const minCount = options.minCount ?? 5

  // compareVersions rounds its delta to one decimal for the agents (0.06 → 0.1) — too coarse for a threshold.
  const errorDelta = (c: VersionChange) => Math.round((c.to.errorRate - c.from.errorRate) * 100) / 100

  const candidates: { change: VersionChange; kind: Regression['kind']; severity: number }[] = []
  for (const change of changes) {
    const { from, to } = change
    // Too few requests, or only compile-time numbers: nothing to claim.
    if (from.count < minCount || to.count < minCount || from.onlyColdStarts || to.onlyColdStarts) continue
    if (change.errorRateChangeSignificant && errorDelta(change) >= minErrorRateDelta) {
      // Failing requests outrank slow ones of similar size: +30% errors ≈ ×4 latency.
      candidates.push({ change, kind: 'errors', severity: 1 + errorDelta(change) * 10 })
    } else if (change.p95Ratio !== null && change.p95Ratio >= minP95Ratio && to.p95Ms - from.p95Ms >= minP95IncreaseMs) {
      candidates.push({ change, kind: 'latency', severity: change.p95Ratio })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => Number(isRoute(b.change.operation)) - Number(isRoute(a.change.operation)) || b.severity - a.severity)
  const { change, kind } = candidates[0]
  const { from, to } = change
  const what =
    kind === 'errors'
      ? `the error rate of ${change.operation} went from ${pct(from.errorRate)} to ${pct(to.errorRate)}`
      : `p95 of ${change.operation} went from ${ms(from.p95Ms)} to ${ms(to.p95Ms)}`
  return {
    service: change.service,
    version: to.version,
    previousVersion: from.version,
    operation: change.operation,
    kind,
    from: { count: from.count, p95Ms: from.p95Ms, errorRate: from.errorRate },
    to: { count: to.count, p95Ms: to.p95Ms, errorRate: to.errorRate },
    p95Ratio: change.p95Ratio,
    errorRateDelta: errorDelta(change),
    question: `${to.version} looks like a regression: since ${from.version} → ${to.version}, ${what}. What is causing it and where in the code?`,
  }
}
