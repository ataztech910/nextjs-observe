import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk'
import { describe, expect, it } from 'vitest'
import { createChatHandler, MockLlm } from '../src/agents/index.js'
import { DEFAULT_CALL_TIMEOUT_MS, ResilientLlm } from '../src/agents/resilient-llm.js'
import type { ChatEvent } from '../src/collector/index.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const text = (t: string): LlmResponse => ({ content: { role: 'model', parts: [{ text: t }] }, turnComplete: true })
const request = { contents: [], toolsDict: {} } as unknown as LlmRequest
const never = new Promise<never>(() => {})

/** Each call takes the next script: 'hang' never answers, a list of strings is yielded chunk by chunk ('hang' inside = stuck mid-answer). */
class ScriptedLlm extends BaseLlm {
  calls = 0
  signals: (AbortSignal | undefined)[] = []
  constructor(private readonly scripts: ('hang' | string[])[]) {
    super({ model: 'scripted' })
  }
  async *generateContentAsync(_request: LlmRequest, _stream?: boolean, signal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    const script = this.scripts[this.calls++] ?? ['(no script)']
    this.signals.push(signal)
    if (script === 'hang') await never
    for (const chunk of script as string[]) {
      if (chunk === 'hang') await never
      yield text(chunk)
    }
  }
  async connect(): Promise<BaseLlmConnection> {
    throw new Error('no live')
  }
}

async function collect(llm: BaseLlm, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = []
  for await (const r of llm.generateContentAsync(request, false, signal)) out.push(r.content?.parts?.[0]?.text ?? '')
  return out
}

describe('ResilientLlm', () => {
  it('passes a normal answer through, calling the model once', async () => {
    const inner = new ScriptedLlm([['a', 'b']])
    const retries: unknown[] = []
    expect(await collect(new ResilientLlm(inner, { callTimeoutMs: 50, onRetry: (i) => retries.push(i) }))).toEqual(['a', 'b'])
    expect(inner.calls).toBe(1)
    expect(retries).toEqual([])
    expect(new ResilientLlm(inner).model).toBe('scripted')
  })

  it('a call that hangs is abandoned (its signal aborted) and started again', async () => {
    const inner = new ScriptedLlm(['hang', ['answer']])
    const retries: unknown[] = []
    expect(await collect(new ResilientLlm(inner, { callTimeoutMs: 30, onRetry: (i) => retries.push(i) }))).toEqual(['answer'])
    expect(inner.calls).toBe(2)
    expect(inner.signals[0]!.aborted).toBe(true)
    expect(inner.signals[1]!.aborted).toBe(false)
    expect(retries).toEqual([{ attempt: 2, attempts: 2, reason: 'no answer within 0s' }])
  })

  it('gives up after the last attempt with a message saying how often it tried', async () => {
    const inner = new ScriptedLlm(['hang', 'hang', ['never reached']])
    await expect(collect(new ResilientLlm(inner, { callTimeoutMs: 20 }))).rejects.toThrow('the model did not answer within 0s (tried 2 times) — try again')
    expect(inner.calls).toBe(2)
    const three = new ScriptedLlm(['hang', 'hang', ['third time lucky']])
    expect(await collect(new ResilientLlm(three, { callTimeoutMs: 20, attempts: 3 }))).toEqual(['third time lucky'])
  })

  it('attempts: 1 means no retry', async () => {
    const inner = new ScriptedLlm(['hang', ['second']])
    await expect(collect(new ResilientLlm(inner, { callTimeoutMs: 20, attempts: 1 }))).rejects.toThrow(/^the model did not answer within 0s — try again$/)
    expect(inner.calls).toBe(1)
  })

  it('stuck in the middle of an answer: no second call — it would repeat what already went out', async () => {
    const inner = new ScriptedLlm([['first half', 'hang'], ['again']])
    const got: string[] = []
    const run = (async () => {
      for await (const r of new ResilientLlm(inner, { callTimeoutMs: 30 }).generateContentAsync(request)) got.push(r.content!.parts![0].text!)
    })()
    await expect(run).rejects.toThrow('the model did not answer within 0s')
    expect(got).toEqual(['first half'])
    expect(inner.calls).toBe(1)
  })

  it('the deadline is per chunk, not for the whole answer', async () => {
    class Slow extends ScriptedLlm {
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        for (const chunk of ['a', 'b', 'c']) {
          await new Promise((r) => setTimeout(r, 25))
          yield text(chunk)
        }
      }
    }
    // 75 ms in total, 25 ms per chunk, 60 ms allowed per chunk.
    expect(await collect(new ResilientLlm(new Slow([]), { callTimeoutMs: 60 }))).toEqual(['a', 'b', 'c'])
  })

  it('an error from the model is not retried — only silence is', async () => {
    class Failing extends ScriptedLlm {
      // eslint-disable-next-line require-yield
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        this.calls++
        throw new Error('quota exceeded')
      }
    }
    const inner = new Failing([])
    await expect(collect(new ResilientLlm(inner, { callTimeoutMs: 50 }))).rejects.toThrow('quota exceeded')
    expect(inner.calls).toBe(1)
  })

  it('the caller’s abort reaches the model', async () => {
    const inner = new ScriptedLlm(['hang', 'hang'])
    const outer = new AbortController()
    const run = collect(new ResilientLlm(inner, { callTimeoutMs: 40 }), outer.signal).catch(() => 'rejected')
    await new Promise((r) => setTimeout(r, 10))
    outer.abort()
    expect(inner.signals[0]!.aborted).toBe(true)
    // …and a cancelled call is not started again: nobody is waiting for the answer.
    expect(await run).toBe('rejected')
    expect(inner.calls).toBe(1)
  })

  it('defaults: 90 s per call — longer than a slow but healthy CLI call', () => {
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(90_000)
  })
})

describe('createChatHandler with a model that hangs', () => {
  /** MockLlm whose N-th call (1-based) never answers. */
  class HangsOnce extends MockLlm {
    calls = 0
    constructor(private readonly hangOn: number) {
      super()
    }
    async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
      if (++this.calls === this.hangOn) await never
      yield* super.generateContentAsync(...args)
    }
  }

  async function run(model: BaseLlm, extra: { modelCallTimeoutMs?: number; timeoutMs?: number; env?: Record<string, string> } = {}) {
    const lines: string[] = []
    const handler = await createChatHandler({ storage: await shopStorage(), env: extra.env ?? {}, queryOptions: { now: () => NOW }, model, log: (l) => lines.push(l), modelCallTimeoutMs: 40, ...extra })
    const events: ChatEvent[] = []
    await handler.handle({ question: 'Why is checkout slow?' }, (e) => events.push(e))
    return { events, lines }
  }

  it('one hung call in the middle of an investigation: the report still arrives, and the terminal says why it took longer', async () => {
    const { events, lines } = await run(new HangsOnce(3))
    expect(events.at(-1)).toMatchObject({ type: 'report' })
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(lines).toEqual(['[next-observer] model call: no answer within 0s — trying again (2/2)'])
  })

  it('the per-call deadline comes from OBSERVE_MODEL_TIMEOUT_MS; a bad value is refused at start', async () => {
    const { events, lines } = await run(new HangsOnce(2), { modelCallTimeoutMs: undefined, env: { OBSERVE_MODEL_TIMEOUT_MS: '30' } })
    expect(events.at(-1)).toMatchObject({ type: 'report' })
    expect(lines).toHaveLength(1)
    await expect(createChatHandler({ storage: await shopStorage(), env: { OBSERVE_MODEL_TIMEOUT_MS: 'soon' } })).rejects.toThrow('OBSERVE_MODEL_TIMEOUT_MS must be a number of milliseconds')
    await expect(createChatHandler({ storage: await shopStorage(), env: { OBSERVE_MODEL_TIMEOUT_MS: '0' } })).rejects.toThrow('OBSERVE_MODEL_TIMEOUT_MS')
    // Above setTimeout's limit the delay would silently become 1 ms — "no deadline" must be refused, not turned into "always late".
    await expect(createChatHandler({ storage: await shopStorage(), env: { OBSERVE_MODEL_TIMEOUT_MS: '9999999999' } })).rejects.toThrow('between 1 and 2147483647')
    await expect(createChatHandler({ storage: await shopStorage(), env: { OBSERVE_MODEL_TIMEOUT_MS: '2147483647' } })).resolves.toBeDefined()
  })
})
