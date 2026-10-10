// Runs the checks from observe.checks.ts on their timers and keeps the latest results. Each request carries a trace
// id of its own (traceparent), so a result links to the trace the app recorded for exactly that request.
import { randomBytes } from 'node:crypto'
import type { Check } from './spec.js'
import type { CheckResult, CheckStatus } from './types.js'

export type { CheckResult, CheckStatus } from './types.js'

export interface CheckRunnerOptions {
  checks: Check[]
  /** Where checks with a path go, e.g. http://localhost:3000. */
  baseUrl: string
  fetch?: typeof fetch
  /** Wall clock, for `atMs`. */
  now?: () => number
  /** A clock that never jumps (NTP, sleep), for durations. Default performance.now. */
  elapsed?: () => number
  /** Results kept per check. Default 50. */
  history?: number
  /** The first run of every check waits this long (the app may still be starting). Default 3 s. */
  firstDelayMs?: number
  /**
   * While the app has not answered yet, a refused connection to it within this time of start() is not a result:
   * `next dev` is still starting. After it, "nobody is listening" is exactly what a check is for. Default 60 s.
   */
  startupGraceMs?: number
  /** A run that met the starting app is tried again this soon, whatever the check's interval. Default 5 s. */
  startupRetryMs?: number
  onResult?: (check: Check, result: CheckResult, failures: number) => void
}

/** Marks the request as the observer's own (the value is the check's name, URL-encoded: header values are ASCII). */
export const CHECK_HEADER = 'x-observe-check'
/** As much of a body as is read: enough for `bodyIncludes`, and a large download is not buffered every minute. */
export const MAX_BODY_BYTES = 1_000_000
/** Trace ids of recent check requests that are remembered, to tell their spans from real traffic. */
const REMEMBERED_TRACES = 5000

const STREAM = /text\/event-stream/i

/**
 * The body as text, up to MAX_BODY_BYTES (`cut` says whether more was left). Not read at all when nobody asked about
 * it (`wanted` false) or when it is an event stream, which never ends.
 */
async function readBody(response: Response, wanted: boolean): Promise<{ text: string; cut: boolean; read: boolean }> {
  if (!response.body) return { text: '', cut: false, read: true }
  if (!wanted || STREAM.test(response.headers.get('content-type') ?? '')) {
    await response.body.cancel().catch(() => {})
    return { text: '', cut: false, read: false }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let cut = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= MAX_BODY_BYTES) {
      cut = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  return { text: Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8'), cut, read: true }
}

/** What run() gives the timer when the app is not listening yet: try again soon. */
const STARTING = Symbol('starting')

export class CheckRunner {
  readonly baseUrl: string
  private readonly checks: Check[]
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly elapsed: () => number
  private readonly keep: number
  private readonly firstDelayMs: number
  private readonly startupGraceMs: number
  private readonly startupRetryMs: number
  private readonly results = new Map<string, CheckResult[]>()
  /** Failed runs in a row per check — counted, not derived from the kept history, which is cut at `keep`. */
  private readonly streak = new Map<string, number>()
  private readonly traces = new Set<string>()
  private running = new Set<string>()
  private inFlight = new Set<AbortController>()
  private timers: ReturnType<typeof setTimeout>[] = []
  /** Changes on every start()/stop(): a run from an earlier one must not report into this one. */
  private generation = 0
  /** On the `elapsed` clock: a wall clock stepping back would keep the grace time open for ever. */
  private startedAt: number | null = null
  /** The app itself (a check with a path) has answered since start(). */
  private appAnswered = false

  constructor(private readonly options: CheckRunnerOptions) {
    this.checks = options.checks
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.elapsed = options.elapsed ?? (() => performance.now())
    this.keep = Math.max(1, options.history ?? 50)
    this.firstDelayMs = options.firstDelayMs ?? 3000
    this.startupGraceMs = options.startupGraceMs ?? 60_000
    this.startupRetryMs = options.startupRetryMs ?? 5000
  }

  /** Was this trace started by one of our own requests? Their spans are not real traffic. */
  isCheckTrace(traceId: string): boolean {
    return this.traces.has(traceId)
  }

  urlOf(check: Check): string {
    return check.url.startsWith('/') ? `${this.baseUrl}${check.url}` : check.url
  }

  /**
   * One request, judged. Never throws: a failed request is a result. Resolves with `undefined` when there is nothing
   * to report — the runner was stopped meanwhile, or the app has not started listening yet (see startupGraceMs).
   */
  async run(check: Check): Promise<CheckResult | undefined> {
    const result = await this.attempt(check)
    return result === STARTING ? undefined : result
  }

  private async attempt(check: Check): Promise<CheckResult | undefined | typeof STARTING> {
    const own = check.url.startsWith('/')
    const generation = this.generation
    const traceId = randomBytes(16).toString('hex')
    this.traces.add(traceId)
    if (this.traces.size > REMEMBERED_TRACES) this.traces.delete(this.traces.values().next().value as string)
    const atMs = this.now()
    const started = this.elapsed()
    const controller = new AbortController()
    this.inFlight.add(controller)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, check.timeoutMs)
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
      if (own) this.appAnswered = true
      const e = check.expect
      // The status is known from here on: a body that never finishes must not turn it into "no answer".
      let body: Awaited<ReturnType<typeof readBody>> | undefined
      try {
        body = await readBody(response, e.bodyIncludes !== undefined || e.maxMs !== undefined)
      } catch (error) {
        if (!timedOut) throw error
      }
      const durationMs = this.elapsed() - started
      const reasons: string[] = []
      if (e.status ? !e.status.includes(response.status) : response.status < 200 || response.status > 299) {
        reasons.push(`expected status ${e.status ? e.status.join(' or ') : '2xx'}, got ${response.status}`)
      }
      if (e.maxMs !== undefined && durationMs > e.maxMs) reasons.push(`took ${Math.round(durationMs)} ms, limit ${e.maxMs} ms`)
      if (!body) reasons.push(`the body did not finish within ${check.timeoutMs} ms`)
      else if (e.bodyIncludes !== undefined && !body.text.includes(e.bodyIncludes)) {
        const where = !body.read ? ' (an event stream is not read)' : body.cut ? ' in its first megabyte (the rest is not read)' : ''
        reasons.push(`body does not contain ${JSON.stringify(e.bodyIncludes)}${where}`)
      }
      result = { atMs, ok: reasons.length === 0, durationMs, status: response.status, traceId, ...(reasons.length ? { reason: reasons.join('; ') } : {}) }
    } catch (error) {
      const durationMs = this.elapsed() - started
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause
      // Only the app's own checks, only "nobody is listening": a wrong host name or a certificate error is news at once.
      const starting = own && cause?.code === 'ECONNREFUSED' && !this.appAnswered && this.startedAt !== null && started - this.startedAt < this.startupGraceMs
      if (starting) return generation === this.generation ? STARTING : undefined
      const reason = timedOut ? `no answer within ${check.timeoutMs} ms` : `request failed: ${cause?.code ?? cause?.message ?? (error as Error)?.message ?? String(error)}`
      result = { atMs, ok: false, durationMs, traceId, reason }
    } finally {
      clearTimeout(timer)
      this.inFlight.delete(controller)
    }
    if (generation !== this.generation) return undefined
    const list = this.results.get(check.name) ?? []
    list.push(result)
    if (list.length > this.keep) list.splice(0, list.length - this.keep)
    this.results.set(check.name, list)
    const failures = result.ok ? 0 : (this.streak.get(check.name) ?? 0) + 1
    this.streak.set(check.name, failures)
    try {
      this.options.onResult?.(check, result, failures)
    } catch {
      // A listener's problem must not stop the checks.
    }
    return result
  }

  /** Starts the timers. A check whose previous run is still waiting for its answer is skipped, not stacked. */
  start(): void {
    this.stop()
    this.startedAt = this.elapsed()
    this.appAnswered = false
    const generation = this.generation
    // This start's own set: a run left over from an earlier start must not hold back the first tick of this one.
    const running = this.running
    for (const check of this.checks) {
      let retryPending = false
      const tick = () => {
        if (running.has(check.name)) return
        running.add(check.name)
        void this.attempt(check)
          .then((result) => {
            // The app is not up yet: do not make a check with a long interval wait a whole interval for its first
            // result. One retry at a time — the interval's own ticks must not each start a chain of them.
            if (result !== STARTING || generation !== this.generation || retryPending) return
            retryPending = true
            const retry = setTimeout(() => {
              retryPending = false
              tick()
            }, this.startupRetryMs)
            retry.unref?.()
            this.timers.push(retry)
          })
          .finally(() => running.delete(check.name))
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

  /** Stops the timers and drops the requests on their way: nothing is recorded or reported after this. */
  stop(): void {
    this.generation++
    // clearTimeout also clears an interval.
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    for (const controller of this.inFlight) controller.abort()
    this.inFlight = new Set()
    this.running = new Set()
    this.startedAt = null
  }

  list(): CheckStatus[] {
    return this.checks.map((check) => {
      const history = this.results.get(check.name) ?? []
      const last = history.at(-1)
      return { name: check.name, method: check.method, url: this.urlOf(check), everySeconds: check.everyMs / 1000, expect: check.expect, failures: this.streak.get(check.name) ?? 0, ...(last ? { last } : {}), history: [...history] }
    })
  }
}
