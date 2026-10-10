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
  /** Wall clock, for `atMs`. */
  now?: () => number
  /** A clock that never jumps (NTP, sleep), for durations. Default performance.now. */
  elapsed?: () => number
  /** Results kept per check. Default 50. */
  history?: number
  /** The first run of every check waits this long (the app may still be starting). Default 3 s. */
  firstDelayMs?: number
  /**
   * While nothing has answered yet, a refused connection within this time of start() is not a result: `next dev` is
   * still starting. After it, "nobody is listening" is exactly what a check is for. Default 60 s.
   */
  startupGraceMs?: number
  onResult?: (check: Check, result: CheckResult, failures: number) => void
}

/** Marks the request as the observer's own (the value is the check's name, URL-encoded: header values are ASCII). */
export const CHECK_HEADER = 'x-observe-check'
/** As much of a body as is read: enough for `bodyIncludes`, and a large download is not buffered every minute. */
export const MAX_BODY_BYTES = 1_000_000
/** Trace ids of recent check requests that are remembered, to tell their spans from real traffic. */
const REMEMBERED_TRACES = 5000

/** The body as text, up to MAX_BODY_BYTES; an event stream never ends, so it is not read at all. */
async function readBody(response: Response): Promise<string> {
  if (!response.body) return ''
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    await response.body.cancel().catch(() => {})
    return ''
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8')
}

export class CheckRunner {
  readonly baseUrl: string
  private readonly checks: Check[]
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly elapsed: () => number
  private readonly keep: number
  private readonly firstDelayMs: number
  private readonly startupGraceMs: number
  private readonly results = new Map<string, CheckResult[]>()
  /** Failed runs in a row per check — counted, not derived from the kept history, which is cut at `keep`. */
  private readonly streak = new Map<string, number>()
  private readonly traces = new Set<string>()
  private running = new Set<string>()
  private inFlight = new Set<AbortController>()
  private timers: ReturnType<typeof setTimeout>[] = []
  /** Changes on every start()/stop(): a run from an earlier one must not report into this one. */
  private generation = 0
  private startedAt: number | null = null
  private answered = false

  constructor(private readonly options: CheckRunnerOptions) {
    this.checks = options.checks
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.elapsed = options.elapsed ?? (() => performance.now())
    this.keep = Math.max(1, options.history ?? 50)
    this.firstDelayMs = options.firstDelayMs ?? 3000
    this.startupGraceMs = options.startupGraceMs ?? 60_000
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
      this.answered = true
      const text = await readBody(response)
      const durationMs = this.elapsed() - started
      const reasons: string[] = []
      const e = check.expect
      if (e.status ? !e.status.includes(response.status) : response.status < 200 || response.status > 299) {
        reasons.push(`expected status ${e.status ? e.status.join(' or ') : '2xx'}, got ${response.status}`)
      }
      if (e.maxMs !== undefined && durationMs > e.maxMs) reasons.push(`took ${Math.round(durationMs)} ms, limit ${e.maxMs} ms`)
      if (e.bodyIncludes !== undefined && !text.includes(e.bodyIncludes)) reasons.push(`body does not contain ${JSON.stringify(e.bodyIncludes)}`)
      result = { atMs, ok: reasons.length === 0, durationMs, status: response.status, traceId, ...(reasons.length ? { reason: reasons.join('; ') } : {}) }
    } catch (error) {
      const durationMs = this.elapsed() - started
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause
      const starting = !timedOut && !this.answered && this.startedAt !== null && atMs - this.startedAt < this.startupGraceMs
      if (starting) return undefined
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
    this.startedAt = this.now()
    // This start's own set: a run left over from an earlier start must not hold back the first tick of this one.
    const running = this.running
    for (const check of this.checks) {
      const tick = () => {
        if (running.has(check.name)) return
        running.add(check.name)
        void this.run(check).finally(() => running.delete(check.name))
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
