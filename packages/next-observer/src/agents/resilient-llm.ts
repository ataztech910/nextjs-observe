// A model call that never answers must not take the whole investigation with it. One agent turn is many model calls
// (≈5–20 s each with a CLI model); when one hangs, the only limit used to be the 180 s of the whole investigation —
// the user waited three minutes for "took longer than 180s". This wrapper gives every single call its own deadline and
// starts it again when it passes.
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk'
import { explainModelError, isTransient, parseModelError } from './model-errors.js'

export interface ResilientLlmOptions {
  /**
   * How long to wait for a call (for each chunk, when streaming). Default 90 s: normal calls take 5–20 s, but a CLI
   * model answers in one piece and may legitimately take longer (Kitana itself gives its CLI 120 s, and may fall back
   * from one CLI to another inside a call) — abandoning a healthy call only starts a duplicate next to it.
   */
  callTimeoutMs?: number
  /** Calls in total, the first one included. Default 2. */
  attempts?: number
  /**
   * Calls in total when the provider answers "too many requests" or "overloaded" (429, 5xx). Default 3: these pass
   * by themselves, unlike a hang.
   */
  transientAttempts?: number
  /**
   * The longest wait before such a retry. The provider's own "retry in N s" is used when it gives one; a longer one
   * (a daily quota: hours) means waiting is pointless, so the error is reported at once. Default 60 s — a per-minute
   * quota (Gemini's free tier: 5 requests a minute, an investigation needs about 10) is back within a minute, and
   * waiting for it beats failing.
   */
  maxRetryDelayMs?: number
  /** Called before a call is started again. */
  onRetry?: (info: { attempt: number; attempts: number; reason: string }) => void
  /**
   * Called with every error that leaves this wrapper. Needed because ADK swallows an error raised inside a specialist
   * (an agent used as a tool): without this nobody would ever see it.
   */
  onError?: (message: string) => void
  /** Replaceable in tests. */
  sleep?: (ms: number) => Promise<void>
}

/** Without a hint from the provider: 2 s, then 6 s. */
const backoffMs = (attempt: number) => 2000 * 3 ** (attempt - 1)

const TIMED_OUT = Symbol('timed out')
export const DEFAULT_CALL_TIMEOUT_MS = 90_000
/** setTimeout's limit: a longer delay silently becomes 1 ms. */
export const MAX_CALL_TIMEOUT_MS = 2_147_483_647

export class ResilientLlm extends BaseLlm {
  private readonly callTimeoutMs: number
  private readonly attempts: number
  private readonly transientAttempts: number
  private readonly maxRetryDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly inner: BaseLlm,
    private readonly options: ResilientLlmOptions = {},
  ) {
    super({ model: inner.model })
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.attempts = Math.max(1, options.attempts ?? 2)
    this.transientAttempts = Math.max(1, options.transientAttempts ?? 3)
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 60_000
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async *generateContentAsync(request: LlmRequest, stream = false, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    // Hangs and provider errors are counted apart: a call may hang once and be rate-limited twice.
    let transientTries = 1
    for (let attempt = 1; ; attempt++) {
      // Our own signal: a provider that supports cancelling (Gemini) stops the hung request; one that does not (a CLI
      // model) keeps running in the background and its late answer is dropped.
      const controller = new AbortController()
      const abort = () => controller.abort()
      abortSignal?.addEventListener('abort', abort, { once: true })
      const responses = this.inner.generateContentAsync(request, stream, controller.signal)
      let answered = false
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined
          const deadline = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), this.callTimeoutMs)))
          let next: IteratorResult<LlmResponse, void> | typeof TIMED_OUT
          try {
            next = await Promise.race([responses.next(), deadline]).finally(() => clearTimeout(timer))
          } catch (error) {
            const failure = parseModelError(error)
            const wait = failure.retryAfterMs ?? backoffMs(transientTries)
            const retry = isTransient(failure) && !answered && transientTries < this.transientAttempts && wait <= this.maxRetryDelayMs && !abortSignal?.aborted
            if (!retry) {
              // An error we know how to explain is rethrown in plain words; anything else exactly as it came.
              if (failure.status === undefined) {
                this.options.onError?.(failure.message)
                throw error
              }
              const explained = explainModelError(failure, transientTries)
              this.options.onError?.(explained)
              throw new Error(explained, { cause: error })
            }
            transientTries++
            const what = failure.status === 429 ? 'rate limit reached (429)' : `provider unavailable (${failure.status})`
            this.options.onRetry?.({ attempt: transientTries, attempts: this.transientAttempts, reason: `${what}, waiting ${Math.ceil(wait / 1000)}s` })
            await this.sleep(wait)
            // The same attempt again: this was not a hang.
            attempt--
            break
          }
          if (next === TIMED_OUT) {
            controller.abort()
            // Not awaited: return() on a generator that is stuck in an await settles only when that await does.
            void responses.return(undefined).catch(() => {})
            const seconds = Math.round(this.callTimeoutMs / 1000)
            // Once part of an answer went out, a second call would repeat it — give up instead. Nor is there anyone
            // to answer once the caller has cancelled.
            if (answered || attempt >= this.attempts || abortSignal?.aborted) {
              const message = `the model did not answer within ${seconds}s${attempt > 1 ? ` (tried ${attempt} times)` : ''} — try again`
              this.options.onError?.(message)
              throw new Error(message)
            }
            this.options.onRetry?.({ attempt: attempt + 1, attempts: this.attempts, reason: `no answer within ${seconds}s` })
            break
          }
          if (next.done) return
          answered = true
          yield next.value
        }
      } finally {
        abortSignal?.removeEventListener('abort', abort)
      }
    }
  }

  connect(request: LlmRequest): Promise<BaseLlmConnection> {
    return this.inner.connect(request)
  }
}
