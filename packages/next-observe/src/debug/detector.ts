// Anomaly detector: a sliding window over incoming spans, three rules, a cooldown per rule. Pure — the clock is injected,
// no timers, no I/O — so the collector drives it and tests control time.
import type { NormalizedSpan } from '../collector/types.js'

export type AnomalyType = 'high_error_rate' | 'high_latency' | 'no_traffic'

export interface Anomaly {
  id: string
  type: AnomalyType
  severity: 'warning' | 'critical'
  detectedAtMs: number
  /** What was measured: error share, slow share, or seconds of silence. */
  value: number
  threshold: number
  /** Server requests in the window the value is based on (0 for no_traffic). */
  sampleSize: number
  windowMs: number
  /** Operations behind the anomaly, worst first. */
  operations: { service: string; operation: string; count: number; errors: number; slow: number }[]
}

export interface DetectorOptions {
  windowMs?: number
  /** Error share of server requests in the window. */
  errorRate?: number
  /** A request slower than this counts as slow. */
  slowMs?: number
  /** Slow share of server requests in the window. */
  slowRate?: number
  /** Silence after traffic was seen. */
  noTrafficMs?: number
  /** Below this many server requests in the window, rates are not judged. */
  minSamples?: number
  /** The same anomaly type is not reported again within this time. */
  cooldownMs?: number
  now?: () => number
}

const DEFAULTS = { windowMs: 10_000, errorRate: 0.2, slowMs: 1000, slowRate: 0.3, noTrafficMs: 120_000, minSamples: 5, cooldownMs: 300_000 }

// Only server entry spans count: Next emits ~7 internal spans per request, which would dilute a 30% error rate below
// any threshold. Browser and internal spans are ignored.
const isServerRequest = (s: NormalizedSpan) => s.kind === 'server'

export class AnomalyDetector {
  readonly options: Required<Omit<DetectorOptions, 'now'>>
  private readonly now: () => number
  private window: { atMs: number; span: NormalizedSpan }[] = []
  private lastSeenMs: number | null = null
  private readonly lastReportedMs = new Map<AnomalyType, number>()
  private seq = 0

  constructor(options: DetectorOptions = {}) {
    const { now, ...rest } = options
    this.options = { ...DEFAULTS, ...rest }
    this.now = now ?? Date.now
  }

  /** Feed spans as they are ingested. */
  observe(spans: NormalizedSpan[]): void {
    const atMs = this.now()
    if (spans.length > 0) this.lastSeenMs = atMs
    for (const span of spans) if (isServerRequest(span)) this.window.push({ atMs, span })
  }

  /** Evaluate the window now; returns new anomalies (respecting cooldowns). */
  check(): Anomaly[] {
    const now = this.now()
    const o = this.options
    this.window = this.window.filter((w) => now - w.atMs <= o.windowMs)
    const requests = this.window.map((w) => w.span)
    const found: Anomaly[] = []

    if (requests.length >= o.minSamples) {
      const errors = requests.filter((s) => s.status === 'error').length
      const slow = requests.filter((s) => s.durationMs > o.slowMs).length
      const errorRate = errors / requests.length
      const slowRate = slow / requests.length
      if (errorRate > o.errorRate) found.push(this.anomaly('high_error_rate', errorRate, o.errorRate, requests, now, errorRate >= 2 * o.errorRate))
      if (slowRate > o.slowRate) found.push(this.anomaly('high_latency', slowRate, o.slowRate, requests, now, slowRate >= 2 * o.slowRate))
    }

    if (this.lastSeenMs !== null && now - this.lastSeenMs > o.noTrafficMs) {
      found.push(this.anomaly('no_traffic', Math.round((now - this.lastSeenMs) / 1000), o.noTrafficMs / 1000, [], now, true))
    }

    return found.filter((a) => {
      const last = this.lastReportedMs.get(a.type)
      if (last !== undefined && now - last < o.cooldownMs) return false
      this.lastReportedMs.set(a.type, now)
      return true
    })
  }

  private anomaly(type: AnomalyType, value: number, threshold: number, requests: NormalizedSpan[], now: number, critical: boolean): Anomaly {
    const byOperation = new Map<string, Anomaly['operations'][number]>()
    for (const s of requests) {
      const key = `${s.service}\u0000${s.name}`
      const entry = byOperation.get(key) ?? { service: s.service, operation: s.name, count: 0, errors: 0, slow: 0 }
      entry.count++
      if (s.status === 'error') entry.errors++
      if (s.durationMs > this.options.slowMs) entry.slow++
      byOperation.set(key, entry)
    }
    const culprit = (e: Anomaly['operations'][number]) => (type === 'high_error_rate' ? e.errors : e.slow)
    const operations = [...byOperation.values()]
      .filter((e) => type === 'no_traffic' || culprit(e) > 0)
      .sort((a, b) => culprit(b) - culprit(a))
      .slice(0, 3)
    return {
      id: `${type}-${now}-${++this.seq}`,
      type,
      severity: critical ? 'critical' : 'warning',
      detectedAtMs: now,
      value: Math.round(value * 1000) / 1000,
      threshold,
      sampleSize: requests.length,
      windowMs: this.options.windowMs,
      operations,
    }
  }
}

/** The question the agents get when an anomaly fires — carries the evidence so they know where to start. */
export function questionFor(anomaly: Anomaly): string {
  const ops = anomaly.operations.map((o) => `${o.operation} (${o.service}: ${o.errors} errors, ${o.slow} slow of ${o.count})`).join('; ')
  const seconds = Math.round(anomaly.windowMs / 1000)
  switch (anomaly.type) {
    case 'high_error_rate':
      return `Anomaly detected: ${Math.round(anomaly.value * 100)}% of server requests failed in the last ${seconds}s (${anomaly.sampleSize} requests). Most affected: ${ops}. Find the failing operation, the exact error and its source.`
    case 'high_latency':
      return `Anomaly detected: ${Math.round(anomaly.value * 100)}% of server requests were slower than threshold in the last ${seconds}s (${anomaly.sampleSize} requests). Most affected: ${ops}. Find what is slow and which deployment introduced it.`
    case 'no_traffic':
      return `Anomaly detected: no spans received for ${anomaly.value}s after traffic was flowing. Check which services went silent.`
  }
}
