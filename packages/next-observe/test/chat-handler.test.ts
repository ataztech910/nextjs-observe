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
  await handler.handle(question, (e) => events.push(e))
  return events
}

describe('createChatHandler', () => {
  it('mock: status → steps → one report, nothing after it', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW } })
    expect(handler.mode).toBe('mock')
    const events = await run(handler)
    expect(events[0]).toEqual({ type: 'status', mode: 'mock', text: 'Investigating…' })
    expect(events.at(-1)).toMatchObject({ type: 'report', text: expect.stringContaining(MOCK_PREFIX) })
    const steps = events.filter((e) => e.type === 'step')
    expect(steps.length).toBeGreaterThan(5)
    expect(steps.map((s) => (s.type === 'step' ? `${s.agent}:${s.tool}` : ''))).toContain('latency_agent:compare_versions')
    expect(events.filter((e) => e.type === 'report')).toHaveLength(1)
  })

  it('times out with an error and lets no late step leak into the finished turn', async () => {
    const slow = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, timeoutMs: 100, model: new SlowMockLlm() })
    const events: ChatEvent[] = []
    await slow.handle('q', (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringContaining('longer than') })
    const countAtEnd = events.length
    await sleep(600) // the investigation keeps running in the background
    expect(events).toHaveLength(countAtEnd)
  })

  it('reports a failing model as an error event, not a crash', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new ThrowingLlm() })
    const events = await run(handler)
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('provider unavailable') })
  })
})
