// Adapts the investigator to the collector's chat protocol.
import { LLMRegistry, type BaseLlm } from '@google/adk'
import type { ChatEvent, ChatHandler } from '../collector/chat.js'
import type { StorageAdapter } from '../collector/types.js'
import type { QueryOptions } from '../debug/queries.js'
import { cardKey, cardsFromResult } from './cards.js'
import { createInvestigator } from './investigator.js'
import type { SpecialistSpec } from './specialists.js'
import { getModel, resolveAiMode, type Env } from './model.js'
import { MAX_CALL_TIMEOUT_MS, ResilientLlm } from './resilient-llm.js'

export interface ChatHandlerOptions {
  /** How many cut-short conversations are remembered (and their history kept) before the oldest is dropped. Default 1000. */
  maxCutSessions?: number
  storage: StorageAdapter
  env?: Env
  queryOptions?: QueryOptions
  /** An investigation that takes longer ends with an error event. Default 240 s: room for one model call to hang (90 s) and be repeated. */
  timeoutMs?: number
  /** Overrides the model chosen from env (tests, custom providers). */
  model?: BaseLlm | string
  /** Default: the built-in specialists; the CLI merges in the project's observe.agents file. */
  specialists?: SpecialistSpec[]
  /**
   * How long one model call may take before it is started again (once). Default: OBSERVE_MODEL_TIMEOUT_MS, else 90 s.
   * Separate from `timeoutMs`, which limits the whole investigation.
   */
  modelCallTimeoutMs?: number
  /** Where "the model did not answer, trying again" goes. Default: the observer's terminal. */
  log?: (line: string) => void
}

function modelCallTimeout(options: ChatHandlerOptions, env: Env): number | undefined {
  if (options.modelCallTimeoutMs !== undefined) return options.modelCallTimeoutMs
  if (!env.OBSERVE_MODEL_TIMEOUT_MS) return undefined
  const ms = Number(env.OBSERVE_MODEL_TIMEOUT_MS)
  // The upper bound matters: a delay above setTimeout's limit silently becomes 1 ms, and every call would "time out".
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_CALL_TIMEOUT_MS) {
    throw new Error(`OBSERVE_MODEL_TIMEOUT_MS must be a number of milliseconds between 1 and ${MAX_CALL_TIMEOUT_MS}, got "${env.OBSERVE_MODEL_TIMEOUT_MS}"`)
  }
  return ms
}

export async function createChatHandler(options: ChatHandlerOptions): Promise<{ mode: 'mock' | 'real'; handle: ChatHandler }> {
  const env = options.env ?? process.env
  const mode = resolveAiMode(env)
  const chosen = options.model ?? (await getModel(env))
  const log = options.log ?? ((line: string) => console.warn(line))
  // A model given by name (Gemini) becomes an instance here, so every provider gets the same per-call deadline.
  const model = new ResilientLlm(typeof chosen === 'string' ? LLMRegistry.newLlm(chosen) : chosen, {
    callTimeoutMs: modelCallTimeout(options, env),
    onRetry: ({ attempt, attempts, reason }) => log(`[next-observer] model call: ${reason} — trying again (${attempt}/${attempts})`),
    onError: (message) => log(`[next-observer] model error: ${message}`),
  })
  const investigator = createInvestigator({
    storage: options.storage,
    model,
    queryOptions: options.queryOptions,
    specialists: options.specialists,
  })
  const timeoutMs = options.timeoutMs ?? 240_000

  // One question at a time per conversation: a second one would interleave with the first in the session history.
  const busy = new Set<string>()
  // Conversations whose last run was cut short (stopped, or timed out). Their history may end in the middle of a step —
  // a tool call without its result — which a provider rejects on the next request; they are not continued.
  const cut = new Set<string>()
  const MAX_CUT_SESSIONS = options.maxCutSessions ?? 1000

  const handle: ChatHandler = async ({ question, sessionId: requested, signal }, emit) => {
    // Reserve synchronously, before any await: two requests for the same session must not both get through.
    if (requested) {
      if (cut.has(requested)) {
        emit({ type: 'error', message: 'this conversation was cut short — ask again in a new chat', closed: true })
        return
      }
      if (busy.has(requested)) {
        emit({ type: 'error', message: 'this chat is still answering the previous question' })
        return
      }
      busy.add(requested)
    }
    let sessionId = requested
    let timedOut = false
    let stopped = false
    let finished = false
    const send = (event: ChatEvent) => {
      if (!finished) emit(event)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)))
    // One way to cancel the run, for a stop and for the timeout alike.
    const own = new AbortController()
    const cancel = signal ? AbortSignal.any([signal, own.signal]) : own.signal
    // Resolves when somebody stops the investigation. The run itself is cancelled through the signal above, but a model
    // that cannot be cancelled (a CLI) would keep us waiting — so the turn ends here, at once.
    let onAbort: (() => void) | undefined
    const stop = new Promise<'stopped'>((resolve) => {
      if (!signal) return
      if (signal.aborted) return resolve('stopped')
      onAbort = () => resolve('stopped')
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const shown = new Set<string>()
    const onResult = (step: { tool: string; args: Record<string, unknown> }, result: unknown) => {
      for (const card of cardsFromResult(step.tool, step.args, result)) {
        const key = cardKey(card)
        if (shown.has(key)) continue
        shown.add(key)
        send({ type: 'card', card })
      }
    }
    try {
      sessionId = await investigator.startSession(requested)
      busy.add(sessionId)
      emit({ type: 'status', mode, sessionId, text: 'Investigating…' })
      const running = investigator.ask(question, { sessionId, onStep: (s) => send({ type: 'step', ...s }), onResult, signal: cancel })
      // A cancelled run rejects or resolves on its own time; nobody is waiting for it any more.
      running.catch(() => {})
      const result = await Promise.race([running, timeout, stop])
      if (result === 'stopped') {
        stopped = true
        send({ type: 'stopped', closed: true })
      } else if (result === 'timeout') {
        timedOut = true
        own.abort()
        send({ type: 'error', message: `investigation took longer than ${Math.round(timeoutMs / 1000)}s — try a narrower question`, closed: true })
      } else if (result.error && !result.text) {
        send({ type: 'error', message: result.error })
      } else {
        send({ type: 'report', text: result.text || '(the agents returned no report)' })
      }
    } catch (error) {
      // The run was cancelled under us: that is the stop, not a failure.
      if (signal?.aborted) {
        stopped = true
        send({ type: 'stopped', closed: true })
      } else send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      // A cancelled run may still be winding down (a CLI model finishes the call it is on): its late steps must not
      // leak into this finished turn — and its conversation is closed for good, so nothing has to wait for it.
      finished = true
      clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      if (sessionId) {
        busy.delete(sessionId)
        if (timedOut || stopped) {
          cut.add(sessionId)
          // The oldest are forgotten, together with their history: an observer that runs for weeks must not keep every
          // stopped turn. Its id then simply starts a clean conversation — the run that used it ended long ago.
          if (cut.size > MAX_CUT_SESSIONS) {
            const oldest = cut.values().next().value as string
            cut.delete(oldest)
            void investigator.endSession(oldest).catch(() => {})
          }
        }
      }
    }
  }
  return { mode, handle }
}
