import { BaseLlm, type BaseLlmConnection, type LlmResponse } from '@google/adk'
import { describe, expect, it } from 'vitest'
import { createChatHandler, MOCK_PREFIX, MockLlm } from '../src/agents/index.js'
import type { ChatEvent } from '../src/collector/index.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class SlowMockLlm extends MockLlm {
  async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
    await sleep(30)
    yield* super.generateContentAsync(...args)
  }
}

class ThrowingLlm extends BaseLlm {
  constructor() {
    super({ model: 'throwing' })
  }
  // eslint-disable-next-line require-yield
  async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
    throw new Error('provider unavailable')
  }
  async connect(): Promise<BaseLlmConnection> {
    throw new Error('no live')
  }
}

async function run(handler: Awaited<ReturnType<typeof createChatHandler>>, question = 'Why is checkout slow?') {
  const events: ChatEvent[] = []
  await handler.handle({ question }, (e) => events.push(e))
  return events
}

describe('createChatHandler', () => {
  it('mock: status → steps → one report, nothing after it', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW } })
    expect(handler.mode).toBe('mock')
    const events = await run(handler)
    expect(events[0]).toEqual({ type: 'status', mode: 'mock', sessionId: expect.any(String), text: 'Investigating…' })
    expect(events.at(-1)).toMatchObject({ type: 'report', text: expect.stringContaining(MOCK_PREFIX) })
    const steps = events.filter((e) => e.type === 'step')
    expect(steps.length).toBeGreaterThan(5)
    expect(steps.map((s) => (s.type === 'step' ? `${s.agent}:${s.tool}` : ''))).toContain('latency_agent:compare_versions')
    expect(events.filter((e) => e.type === 'report')).toHaveLength(1)
  })

  it('times out with an error and lets no late step leak into the finished turn', async () => {
    const slow = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, timeoutMs: 100, model: new SlowMockLlm() })
    const events: ChatEvent[] = []
    await slow.handle({ question: 'q' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringContaining('longer than') })
    const countAtEnd = events.length
    await sleep(600) // the investigation keeps running in the background
    expect(events).toHaveLength(countAtEnd)
  })

  describe('stopping an investigation', () => {
    const slowHandler = async () => createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new SlowMockLlm() })

    it('ends the turn at once with `stopped`, and nothing comes after it', async () => {
      const handler = await slowHandler()
      const controller = new AbortController()
      const events: ChatEvent[] = []
      const turn = handler.handle({ question: 'q', signal: controller.signal }, (e) => events.push(e))
      await sleep(80) // a few steps in
      const before = Date.now()
      controller.abort()
      await turn
      expect(Date.now() - before).toBeLessThan(200)
      expect(events[0]).toMatchObject({ type: 'status' })
      expect(events.at(-1)).toEqual({ type: 'stopped' })
      expect(events.some((e) => e.type === 'report' || e.type === 'error')).toBe(false)
      const countAtEnd = events.length
      await sleep(600)
      expect(events).toHaveLength(countAtEnd)
    })

    it('really stops the run: far fewer steps than an investigation left alone', async () => {
      const full = await run(await slowHandler(), 'q')
      const controller = new AbortController()
      const seen: ChatEvent[] = []
      const steps: string[] = []
      // Count what the agents go on doing behind the finished turn, through the model itself.
      class CountingLlm extends SlowMockLlm {
        async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
          steps.push('call')
          yield* super.generateContentAsync(...args)
        }
      }
      const counted = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new CountingLlm() })
      const turn = counted.handle({ question: 'q', signal: controller.signal }, (e) => seen.push(e))
      await sleep(80)
      controller.abort()
      await turn
      const callsAtStop = steps.length
      await sleep(800)
      const fullCalls = full.filter((e) => e.type === 'step').length
      // After the stop the run winds down: at most the call already in flight finishes.
      expect(steps.length - callsAtStop).toBeLessThanOrEqual(2)
      expect(steps.length).toBeLessThan(fullCalls)
    })

    it('a signal already aborted starts nothing — not even one model call', async () => {
      let calls = 0
      class CountingLlm extends SlowMockLlm {
        async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
          calls++
          yield* super.generateContentAsync(...args)
        }
      }
      const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new CountingLlm() })
      const events: ChatEvent[] = []
      await handler.handle({ question: 'q', signal: AbortSignal.abort() }, (e) => events.push(e))
      await sleep(200)
      expect(events.map((e) => e.type)).toEqual(['status', 'stopped'])
      expect(calls).toBe(0)
    })

    it('a model that cannot be cancelled keeps the conversation busy until its call returns', async () => {
      // A CLI model ignores the signal: its call runs to the end and may still write into the session.
      class DeafLlm extends MockLlm {
        async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
          await sleep(500)
          yield* super.generateContentAsync(...args)
        }
      }
      const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new DeafLlm() })
      const controller = new AbortController()
      const first: ChatEvent[] = []
      const turn = handler.handle({ question: 'q', signal: controller.signal }, (e) => first.push(e))
      await sleep(80)
      controller.abort()
      await turn
      expect(first.at(-1)).toEqual({ type: 'stopped' })
      const sessionId = (first[0] as { sessionId: string }).sessionId
      const second: ChatEvent[] = []
      await handler.handle({ question: 'and now?', sessionId }, (e) => second.push(e))
      expect(second).toEqual([{ type: 'error', message: 'this chat is still answering the previous question' }])
    })

    it('frees the conversation: the next question in the same session is answered', async () => {
      const handler = await slowHandler()
      const controller = new AbortController()
      const first: ChatEvent[] = []
      const turn = handler.handle({ question: 'q', signal: controller.signal }, (e) => first.push(e))
      await sleep(80)
      controller.abort()
      await turn
      const sessionId = (first[0] as { sessionId: string }).sessionId
      // The cancelled run may need a moment to wind down; until then the session says it is busy.
      let second: ChatEvent[] = []
      for (let i = 0; i < 40; i++) {
        second = []
        await handler.handle({ question: 'and now?', sessionId }, (e) => second.push(e))
        if (second.at(-1)?.type === 'report') break
        await sleep(100)
      }
      expect(second.at(-1)?.type).toBe('report')
    }, 15_000)

    it('without a stop, a signal changes nothing', async () => {
      const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW } })
      const events: ChatEvent[] = []
      await handler.handle({ question: 'Why is checkout slow?', signal: new AbortController().signal }, (e) => events.push(e))
      expect(events.at(-1)?.type).toBe('report')
    })
  })

  it('reports a failing model as an error event, not a crash', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new ThrowingLlm() })
    const events = await run(handler)
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('provider unavailable') })
  })
})
