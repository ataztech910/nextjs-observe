// Adapts the investigator to the collector's chat protocol.
import { LLMRegistry, type BaseLlm } from '@google/adk'
import type { ChatEvent, ChatHandler } from '../collector/chat.js'
import type { StorageAdapter } from '../collector/types.js'
import type { QueryOptions } from '../debug/queries.js'
import { cardKey, cardsFromResult } from './cards.js'
import { createInvestigator } from './investigator.js'
import type { SpecialistSpec } from './specialists.js'
import { getModel, resolveAiMode, type Env } from './model.js'
import { ResilientLlm } from './resilient-llm.js'

export interface ChatHandlerOptions {
  storage: StorageAdapter
  env?: Env
  queryOptions?: QueryOptions
  /** An investigation that takes longer ends with an error event. Default 180 s — a CLI model can hang. */
  timeoutMs?: number
  /** Overrides the model chosen from env (tests, custom providers). */
  model?: BaseLlm | string
  /** Default: the built-in specialists; the CLI merges in the project's observe.agents file. */
  specialists?: SpecialistSpec[]
  /**
   * How long one model call may take before it is started again (once). Default: OBSERVE_MODEL_TIMEOUT_MS, else 60 s.
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
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`OBSERVE_MODEL_TIMEOUT_MS must be a positive number of milliseconds, got "${env.OBSERVE_MODEL_TIMEOUT_MS}"`)
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
  })
  const investigator = createInvestigator({
    storage: options.storage,
    model,
    queryOptions: options.queryOptions,
    specialists: options.specialists,
  })
  const timeoutMs = options.timeoutMs ?? 180_000

  // One question at a time per conversation: a second one would interleave with the first in the session history.
  const busy = new Set<string>()

  const handle: ChatHandler = async ({ question, sessionId: requested }, emit) => {
    // Reserve synchronously, before any await: two requests for the same session must not both get through.
    if (requested) {
      if (busy.has(requested)) {
        emit({ type: 'error', message: 'this chat is still answering the previous question' })
        return
      }
      busy.add(requested)
    }
    let sessionId = requested
    let investigation: Promise<unknown> | undefined
    let timedOut = false
    let finished = false
    const send = (event: ChatEvent) => {
      if (!finished) emit(event)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)))
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
      const running = investigator.ask(question, { sessionId, onStep: (s) => send({ type: 'step', ...s }), onResult })
      investigation = running
      const result = await Promise.race([running, timeout])
      if (result === 'timeout') {
        timedOut = true
        send({ type: 'error', message: `investigation took longer than ${Math.round(timeoutMs / 1000)}s — try a narrower question` })
      } else if (result.error && !result.text) {
        send({ type: 'error', message: result.error })
      } else {
        send({ type: 'report', text: result.text || '(the agents returned no report)' })
      }
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      // A timed-out investigation keeps running and writing to the session: its late steps must not leak into this
      // finished turn, and the session stays busy until it really ends.
      finished = true
      clearTimeout(timer)
      const release = () => {
        if (sessionId) busy.delete(sessionId)
      }
      if (timedOut && investigation) investigation.then(release, release)
      else release()
    }
  }
  return { mode, handle }
}
