// Anomaly detector: a sliding window over incoming spans, three rules, a cooldown per rule. Pure — the clock is injected,
// no timers, no I/O — so the collector drives it and tests control time.
import { checkFailureQuestion } from '../checks/words.js'
import type { NormalizedSpan, SpanEvent } from '../collector/types.js'

export type AnomalyType = 'high_error_rate' | 'high_latency' | 'no_traffic' | 'data_integrity' | 'check_failed'

export interface Anomaly {
  id: string
  type: AnomalyType
  /** 'all' = share of all server requests; 'operation' = one operation failing/slow on its own (see `subject`). */
  scope: 'all' | 'operation'
  subject?: { service: string; operation: string }
  severity: 'warning' | 'critical'
  detectedAtMs: number
  /** What was measured: error share, slow share, seconds of silence, or (data_integrity) a raw failure count. */
  value: number
  threshold: number
  /** Server requests in the window the value is based on (0 for no_traffic). */
  sampleSize: number
  windowMs: number
  /** Operations behind the anomaly, worst first. */
  operations: { service: string; operation: string; count: number; errors: number; slow: number }[]
  /**
   * `data_integrity` only: the specific checks that failed, each one evidence a latency/error-rate chart can never
   * show — the response came back fast, with a 2xx, and still was not the one that was asked for.
   */
  integrityFailures?: { service: string; operation: string; traceId: string; expected: unknown; actual: unknown }[]
  /**
   * `check_failed` only (raised by checks/watch.ts, not by this detector): the scheduled check that keeps failing.
   * `value` is then the failures in a row (`rule: 'in_row'`) or the failures among the latest `sampleSize` runs (`'share'`).
   */
  check?: { name: string; method: string; url: string; rule: 'in_row' | 'share'; reason: string; status?: number; unreachable?: true; traceId: string }
}

export interface DetectorOptions {
  /** Window for the app-wide rule. */
  windowMs?: number
  /**
   * Window for the per-operation rule. Longer than the app-wide one: an operation is a fraction of the traffic, and in
   * 10 s a checkout at ~0.6 requests/s gets 3–5 samples — under minSamples, so a ×7 slowdown went unnoticed.
   */
  operationWindowMs?: number
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

const DEFAULTS = { windowMs: 10_000, operationWindowMs: 30_000, errorRate: 0.2, slowMs: 1000, slowRate: 0.3, noTrafficMs: 120_000, minSamples: 5, cooldownMs: 300_000 }

// Only server entry spans count for the rate-based rules below: Next emits ~7 internal spans per request, which
// would dilute a 30% error rate below any threshold. Browser and internal spans are ignored there.
const isServerRequest = (s: NormalizedSpan) => s.kind === 'server'

/**
 * A span whose own status/duration are both unremarkable — fast, 2xx — can still carry proof that the data inside it
 * was wrong: code that verified "did I get back what I asked for" records that verdict as this event, independent of
 * whether the span threw. See docs/APM_FINDINGS.md, incident F: a connection pooler in transaction-pooling mode can
 * return another concurrent query's result instead of erroring or hanging — nothing about status or latency shows it.
 */
export const INTEGRITY_CHECK_EVENT = 'integrity_check'
/** Exported so agent tools (debug/queries.ts: getTrace) can show the same evidence the detector acted on — an
 * anomaly whose question names a trace id is only as trustworthy as the agent's own ability to go look at it. */
export function integrityFailureEvent(s: NormalizedSpan): SpanEvent | undefined {
  return s.events.find((e) => e.name === INTEGRITY_CHECK_EVENT && e.attributes.ok === false)
}

export class AnomalyDetector {
  readonly options: Required<Omit<DetectorOptions, 'now'>>
  private readonly now: () => number
  private window: { atMs: number; span: NormalizedSpan }[] = []
  private lastSeenMs: number | null = null
  /** Cooldown per type (app-wide) or per type + operation. */
  private readonly lastReportedMs = new Map<string, number>()
  /** Reported anomalies within the cooldown — to skip ones that only repeat them at the other scope. */
  private reported: Anomaly[] = []
  private seq = 0

  constructor(options: DetectorOptions = {}) {
    const { now, ...rest } = options
    this.options = { ...DEFAULTS, ...rest }
    this.now = now ?? Date.now
  }

  /**
   * Feed spans as they are ingested. Kept beyond server-entry spans: any span carrying a failed `integrity_check`
   * event, since that check naturally lives on the call that did the verifying (e.g. a `db.query` child span) —
   * dropping non-server spans here would make the data_integrity rule below unable to ever see its own evidence.
   */
  observe(spans: NormalizedSpan[]): void {
    const atMs = this.now()
    if (spans.length > 0) this.lastSeenMs = atMs
    for (const span of spans) if (isServerRequest(span) || integrityFailureEvent(span)) this.window.push({ atMs, span })
  }

  /** Evaluate the window now; returns new anomalies (respecting cooldowns). */
  check(): Anomaly[] {
    const now = this.now()
    const o = this.options
    this.window = this.window.filter((w) => now - w.atMs <= Math.max(o.windowMs, o.operationWindowMs))
    // `within` includes the non-server spans kept only for their integrity-check event (see `observe`); the
    // rate-based rules must not see those, so they go through `serverWithin` instead.
    const within = (ms: number) => this.window.filter((w) => now - w.atMs <= ms).map((w) => w.span)
    const serverWithin = (ms: number) => within(ms).filter(isServerRequest)
    const found: Anomaly[] = []

    const judge = (list: NormalizedSpan[], windowMs: number, subject?: Anomaly['subject']) => {
      if (list.length < o.minSamples) return
      const errorRate = list.filter((s) => s.status === 'error').length / list.length
      const slowRate = list.filter((s) => s.durationMs > o.slowMs).length / list.length
      // An operation-level anomaly would only repeat an app-wide one of the same type.
      const covered = (type: AnomalyType) => subject && found.some((a) => a.type === type && a.scope === 'all')
      if (errorRate > o.errorRate && !covered('high_error_rate')) {
        found.push(this.anomaly('high_error_rate', errorRate, o.errorRate, list, now, errorRate >= 2 * o.errorRate, windowMs, subject))
      }
      if (slowRate > o.slowRate && !covered('high_latency')) {
        found.push(this.anomaly('high_latency', slowRate, o.slowRate, list, now, slowRate >= 2 * o.slowRate, windowMs, subject))
      }
    }
    judge(serverWithin(o.windowMs), o.windowMs)
    // Per operation: on a realistic route mix one broken endpoint (30% errors) is only ~10% of all requests —
    // below the app-wide threshold, yet clearly an incident.
    const byOperation = new Map<string, NormalizedSpan[]>()
    for (const s of serverWithin(o.operationWindowMs)) {
      const key = `${s.service}\u0000${s.name}`
      byOperation.set(key, [...(byOperation.get(key) ?? []), s])
    }
    for (const list of byOperation.values()) judge(list, o.operationWindowMs, { service: list[0].service, operation: list[0].name })

    // Zero-tolerance, unlike the two rate-based rules above: a wrong-data response is never acceptable even once, so
    // this does not wait for a share to cross a threshold (and does not need minSamples — one occurrence among two
    // requests is already the whole story, not noise). Scans `within`, not `serverWithin`: the check naturally lives
    // on the span that did the verifying (often a db.query child span, not the server entry span), so excluding
    // non-server spans here would make this rule unable to ever see its own evidence.
    const byOperationAny = new Map<string, NormalizedSpan[]>()
    for (const s of within(o.operationWindowMs)) {
      const key = `${s.service}\u0000${s.name}`
      byOperationAny.set(key, [...(byOperationAny.get(key) ?? []), s])
    }
    const judgeIntegrity = (list: NormalizedSpan[], windowMs: number, subject?: Anomaly['subject']) => {
      const bad = list.filter((s) => integrityFailureEvent(s) !== undefined)
      if (bad.length === 0) return
      if (subject && found.some((a) => a.type === 'data_integrity' && a.scope === 'all')) return
      found.push(this.integrityAnomaly(bad, now, windowMs, subject))
    }
    judgeIntegrity(within(o.windowMs), o.windowMs)
    for (const list of byOperationAny.values()) judgeIntegrity(list, o.operationWindowMs, { service: list[0].service, operation: list[0].name })

    if (this.lastSeenMs !== null && now - this.lastSeenMs > o.noTrafficMs) {
      found.push(this.anomaly('no_traffic', Math.round((now - this.lastSeenMs) / 1000), o.noTrafficMs / 1000, [], now, true, o.windowMs))
    }

    this.reported = this.reported.filter((r) => now - r.detectedAtMs < o.cooldownMs)
    return found.filter((a) => {
      const key = a.subject ? `${a.type}\u0000${a.subject.service}\u0000${a.subject.operation}` : a.type
      const last = this.lastReportedMs.get(key)
      if (last !== undefined && now - last < o.cooldownMs) return false
      if (this.alreadyExplained(a)) return false
      this.lastReportedMs.set(key, now)
      this.reported.push(a)
      return true
    })
  }

  /**
   * The same problem seen at the other scope, in another check: one failing endpoint first trips its operation rule
   * (30 s window), seconds later the app-wide one (10 s) — two investigations of one problem. An app-wide anomaly is
   * explained when every culprit operation already had its own anomaly of that type; an operation anomaly when a recent
   * app-wide one already named it. An app-wide anomaly with a culprit nobody reported yet still says something new.
   */
  private alreadyExplained(a: Anomaly): boolean {
    if (a.type === 'no_traffic') return false
    const op = (service: string, operation: string) => `${service}\u0000${operation}`
    const recent = (scope: Anomaly['scope']) => this.reported.filter((r) => r.type === a.type && r.scope === scope)
    if (a.scope === 'all') {
      const reportedOps = new Set(recent('operation').map((r) => op(r.subject!.service, r.subject!.operation)))
      return a.operations.length > 0 && a.operations.every((c) => reportedOps.has(op(c.service, c.operation)))
    }
    const self = op(a.subject!.service, a.subject!.operation)
    return recent('all').some((r) => r.operations.some((c) => op(c.service, c.operation) === self))
  }

  private anomaly(type: AnomalyType, value: number, threshold: number, requests: NormalizedSpan[], now: number, critical: boolean, windowMs: number, subject?: Anomaly['subject']): Anomaly {
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
      scope: subject ? 'operation' : 'all',
      ...(subject ? { subject } : {}),
      severity: critical ? 'critical' : 'warning',
      detectedAtMs: now,
      value: Math.round(value * 1000) / 1000,
      threshold,
      sampleSize: requests.length,
      windowMs,
      operations,
    }
  }

  /**
   * `bad` are spans whose own status/duration passed every other rule and still carry proof they returned the wrong
   * data (see `integrityFailureEvent`) — always `critical`, there is no "warning" tier for a response that lied.
   */
  private integrityAnomaly(bad: NormalizedSpan[], now: number, windowMs: number, subject?: Anomaly['subject']): Anomaly {
    const byOperation = new Map<string, Anomaly['operations'][number]>()
    for (const s of bad) {
      const key = `${s.service}\u0000${s.name}`
      const entry = byOperation.get(key) ?? { service: s.service, operation: s.name, count: 0, errors: 0, slow: 0 }
      entry.count++
      entry.errors++ // reuses `errors` as "failures" so existing operations-sorting/display code needs no new field
      byOperation.set(key, entry)
    }
    const integrityFailures = bad.slice(0, 5).map((s) => {
      const event = integrityFailureEvent(s)!
      return { service: s.service, operation: s.name, traceId: s.traceId, expected: event.attributes.expected, actual: event.attributes.actual }
    })
    return {
      id: `data_integrity-${now}-${++this.seq}`,
      type: 'data_integrity',
      scope: subject ? 'operation' : 'all',
      ...(subject ? { subject } : {}),
      severity: 'critical',
      detectedAtMs: now,
      value: bad.length,
      threshold: 0,
      sampleSize: bad.length,
      windowMs,
      operations: [...byOperation.values()].sort((a, b) => b.errors - a.errors).slice(0, 3),
      integrityFailures,
    }
  }
}

/** The question the agents get when an anomaly fires — carries the evidence so they know where to start. */
export function questionFor(anomaly: Anomaly): string {
  const ops = anomaly.operations.map((o) => `${o.operation} (${o.service}: ${o.errors} errors, ${o.slow} slow of ${o.count})`).join('; ')
  const seconds = Math.round(anomaly.windowMs / 1000)
  const what = anomaly.subject ? `${anomaly.subject.operation} requests` : 'server requests'
  switch (anomaly.type) {
    case 'high_error_rate':
      return `Anomaly detected: ${Math.round(anomaly.value * 100)}% of ${what} failed in the last ${seconds}s (${anomaly.sampleSize} requests). Most affected: ${ops}. Find the failing operation, the exact error and its source.`
    case 'high_latency':
      return `Anomaly detected: ${Math.round(anomaly.value * 100)}% of ${what} were slower than threshold in the last ${seconds}s (${anomaly.sampleSize} requests). Most affected: ${ops}. Find what is slow and which deployment introduced it.`
    case 'data_integrity': {
      const sample = anomaly.integrityFailures?.[0]
      const evidence = sample ? ` Example: asked for ${JSON.stringify(sample.expected)}, got back ${JSON.stringify(sample.actual)} (trace ${sample.traceId}).` : ''
      return `Anomaly detected: ${anomaly.sampleSize} response(s) to ${what} in the last ${seconds}s did not match what was requested — not an error, not slow, just wrong.${evidence} This is not a latency or error-rate problem: find what these requests share (same connection pool? same deployment?) and whether it is still happening.`
    }
    case 'check_failed': {
      const c = anomaly.check
      if (!c) return 'Anomaly detected: a scheduled check keeps failing.'
      return `Anomaly detected: ${checkFailureQuestion({ ...c, count: anomaly.value, runs: anomaly.sampleSize })}`
    }
    case 'no_traffic':
      return `Anomaly detected: no spans received for ${anomaly.value}s after traffic was flowing. Check which services went silent.`
  }
}
