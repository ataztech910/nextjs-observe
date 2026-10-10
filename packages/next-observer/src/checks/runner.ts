// Runs the checks from observe.checks.ts on their timers and keeps the latest results. Each request carries a trace
// id of its own (traceparent), so a result links to the trace the app recorded for exactly that request.
import { randomBytes } from 'node:crypto'
import type { Check } from './spec.js'

export interface CheckResult {
  atMs: number
  ok: boolean
  durationMs: number
  /** Absent when no answer came at all. */
  status?: number
  /** The trace id sent with the request. */
  traceId: string
  /** Why it failed, in words; absent when ok. */
  reason?: string
}

export interface CheckStatus {
  name: string
  method: string
  /** Where the request really goes. */
  url: string
  everySeconds: number
  expect: Check['expect']
  /** Failed runs in a row up to now; 0 when the last run passed or nothing ran yet. */
  failures: number
  last?: CheckResult
  /** Oldest first. */
  history: CheckResult[]
}

export interface CheckRunnerOptions {
  checks: Check[]
  /** Where checks with a path go, e.g. http://localhost:3000. */
  baseUrl: string
  fetch?: typeof fetch
  now?: () => number
  /** Results kept per check. Default 50. */
  history?: number
  /** The first run of every check waits this long (the app may still be starting). Default 3 s. */
  firstDelayMs?: number
  onResult?: (check: Check, result: CheckResult, failures: number) => void
}

/** Marks the request as the observer's own, so the app (or a later step) can tell it from real visitors. */
export const CHECK_HEADER = 'x-observe-check'

export class CheckRunner {
  readonly baseUrl: string
  private readonly checks: Check[]
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly keep: number
  private readonly firstDelayMs: number
  private readonly results = new Map<string, CheckResult[]>()
  private readonly running = new Set<string>()
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly options: CheckRunnerOptions) {
    this.checks = options.checks
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.keep = Math.max(1, options.history ?? 50)
    this.firstDelayMs = options.firstDelayMs ?? 3000
  }

  urlOf(check: Check): string {
    return check.url.startsWith('/') ? `${this.baseUrl}${check.url}` : check.url
  }

  /** One request, judged. Never throws: a failed request is a result. */
  async run(check: Check): Promise<CheckResult> {
    const traceId = randomBytes(16).toString('hex')
    const atMs = this.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), check.timeoutMs)
    let result: CheckResult
    try {
      const response = await this.fetch(this.urlOf(check), {
        method: check.method,
        // Ours last: a check cannot switch off its own trace link or mark.
        headers: { ...check.headers, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`, [CHECK_HEADER]: encodeURIComponent(check.name) },
        body: check.body,
        // A redirect is an answer ("anonymous visitors are sent to /login"), not something to follow.
        redirect: 'manual',
        signal: controller.signal,
      })
      const text = await response.text()
      const durationMs = this.now() - atMs
      const reasons: string[] = []
      const e = check.expect
      if (e.status ? !e.status.includes(response.status) : response.status < 200 || response.status > 299) {
        reasons.push(`expected status ${e.status ? e.status.join(' or ') : '2xx'}, got ${response.status}`)
      }
      if (e.maxMs !== undefined && durationMs > e.maxMs) reasons.push(`took ${Math.round(durationMs)} ms, limit ${e.maxMs} ms`)
      if (e.bodyIncludes !== undefined && !text.includes(e.bodyIncludes)) reasons.push(`body does not contain ${JSON.stringify(e.bodyIncludes)}`)
      result = { atMs, ok: reasons.length === 0, durationMs, status: response.status, traceId, ...(reasons.length ? { reason: reasons.join('; ') } : {}) }
    } catch (error) {
      const durationMs = this.now() - atMs
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause
      const reason = controller.signal.aborted ? `no answer within ${check.timeoutMs} ms` : `request failed: ${cause?.code ?? cause?.message ?? (error as Error)?.message ?? String(error)}`
      result = { atMs, ok: false, durationMs, traceId, reason }
    } finally {
      clearTimeout(timer)
    }
    const list = this.results.get(check.name) ?? []
    list.push(result)
    if (list.length > this.keep) list.splice(0, list.length - this.keep)
    this.results.set(check.name, list)
    try {
      this.options.onResult?.(check, result, failuresIn(list))
    } catch {
      // A listener's problem must not stop the checks.
    }
    return result
  }

  /** Starts the timers. A check whose previous run is still waiting for its answer is skipped, not stacked. */
  start(): void {
    this.stop()
    for (const check of this.checks) {
      const tick = () => {
        if (this.running.has(check.name)) return
        this.running.add(check.name)
        void this.run(check).finally(() => this.running.delete(check.name))
      }
      const first = setTimeout(() => {
        tick()
        const every = setInterval(tick, check.everyMs)
        every.unref?.()
        this.timers.push(every)
      }, Math.min(this.firstDelayMs, check.everyMs))
      first.unref?.()
      this.timers.push(first)
    }
  }

  stop(): void {
    // clearTimeout also clears an interval.
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  list(): CheckStatus[] {
    return this.checks.map((check) => {
      const history = this.results.get(check.name) ?? []
      const last = history.at(-1)
      return { name: check.name, method: check.method, url: this.urlOf(check), everySeconds: check.everyMs / 1000, expect: check.expect, failures: failuresIn(history), ...(last ? { last } : {}), history: [...history] }
    })
  }
}

function failuresIn(history: CheckResult[]): number {
  let n = 0
  for (let i = history.length - 1; i >= 0 && !history[i].ok; i--) n++
  return n
}
