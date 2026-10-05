// A model call that never answers must not take the whole investigation with it. One agent turn is many model calls
// (≈5–20 s each with a CLI model); when one hangs, the only limit used to be the 180 s of the whole investigation —
// the user waited three minutes for "took longer than 180s". This wrapper gives every single call its own deadline and
// starts it again when it passes.
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk'

export interface ResilientLlmOptions {
  /** How long to wait for a call (for each chunk, when streaming). Default 60 s — several times a normal call. */
  callTimeoutMs?: number
  /** Calls in total, the first one included. Default 2. */
  attempts?: number
  /** Called before a call is started again. */
  onRetry?: (info: { attempt: number; attempts: number; reason: string }) => void
}

const TIMED_OUT = Symbol('timed out')

export class ResilientLlm extends BaseLlm {
  private readonly callTimeoutMs: number
  private readonly attempts: number

  constructor(
    private readonly inner: BaseLlm,
    private readonly options: ResilientLlmOptions = {},
  ) {
    super({ model: inner.model })
    this.callTimeoutMs = options.callTimeoutMs ?? 60_000
    this.attempts = Math.max(1, options.attempts ?? 2)
  }

  async *generateContentAsync(request: LlmRequest, stream = false, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
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
          const next = await Promise.race([responses.next(), deadline]).finally(() => clearTimeout(timer))
          if (next === TIMED_OUT) {
            controller.abort()
            // Not awaited: return() on a generator that is stuck in an await settles only when that await does.
            void responses.return(undefined).catch(() => {})
            const seconds = Math.round(this.callTimeoutMs / 1000)
            // Once part of an answer went out, a second call would repeat it — give up instead.
            if (answered || attempt >= this.attempts) {
              throw new Error(`the model did not answer within ${seconds}s${attempt > 1 ? ` (tried ${attempt} times)` : ''} — try again`)
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
