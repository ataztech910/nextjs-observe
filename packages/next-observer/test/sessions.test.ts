import { FunctionTool, type LlmRequest, type LlmResponse } from '@google/adk'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createChatHandler, createInvestigator, MockLlm } from '../src/agents/index.js'
import { startCollector, type ChatEvent, type ChatHandler, type ChatRequest, type Collector } from '../src/collector/index.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const textsOf = (request: LlmRequest) => request.contents.flatMap((c) => (c.parts ?? []).map((p) => p.text ?? '')).join('\n')

// Records what the orchestrator (the only agent that owns latency_agent) is sent on each turn.
class SpyLlm extends MockLlm {
  orchestratorInputs: string[] = []
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    if (request.toolsDict?.latency_agent) this.orchestratorInputs.push(textsOf(request))
    yield* super.generateContentAsync(request)
  }
}

class SlowMockLlm extends MockLlm {
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    await new Promise((r) => setTimeout(r, 20))
    yield* super.generateContentAsync(request)
  }
}

describe('MockLlm across turns', () => {
  it('starts calling tools again on a new question in the same history', async () => {
    const tool = new FunctionTool({ name: 'get_services', description: 'd', parameters: z.object({}), execute: async () => ({}) })
    const request = {
      contents: [
        { role: 'user', parts: [{ text: 'first question' }] },
        { role: 'model', parts: [{ functionCall: { name: 'get_services', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'get_services', response: {} } }] },
        { role: 'model', parts: [{ text: '[mock] answer one' }] },
        { role: 'user', parts: [{ text: 'second question' }] },
      ],
      toolsDict: { get_services: tool },
      liveConnectConfig: {},
    } as LlmRequest
    const responses: LlmResponse[] = []
    for await (const r of new MockLlm().generateContentAsync(request)) responses.push(r)
    const [response] = responses
    expect(response.content!.parts![0]).toEqual({ functionCall: { name: 'get_services', args: {} } })
  })
})

describe('investigator sessions', () => {
  it('shows the orchestrator the previous question and answer when the session continues', async () => {
    const spy = new SpyLlm()
    const investigator = createInvestigator({ storage: await shopStorage(), model: spy, queryOptions: { now: () => NOW } })
    const first = await investigator.ask('Why is checkout slow?')
    spy.orchestratorInputs.length = 0
    const second = await investigator.ask('And which deployment caused it?', { sessionId: first.sessionId })

    expect(second.sessionId).toBe(first.sessionId)
    expect(spy.orchestratorInputs[0]).toContain('Why is checkout slow?')
    expect(spy.orchestratorInputs[0]).toContain(first.text.slice(0, 40))
    expect(spy.orchestratorInputs[0]).toContain('And which deployment caused it?')
    // the new turn still investigates: specialists and tools ran again
    expect(second.steps.some((s) => s.agent === 'latency_agent')).toBe(true)
  })

  it('keeps separate conversations apart', async () => {
    const spy = new SpyLlm()
    const investigator = createInvestigator({ storage: await shopStorage(), model: spy, queryOptions: { now: () => NOW } })
    const first = await investigator.ask('Why is checkout slow?')
    spy.orchestratorInputs.length = 0
    const other = await investigator.ask('Anything failing?')
    expect(other.sessionId).not.toBe(first.sessionId)
    expect(spy.orchestratorInputs.join('\n')).not.toContain('Why is checkout slow?')
  })

  it('accepts an unknown session id (e.g. the UI kept it across an next-observer restart) as a new conversation', async () => {
    const investigator = createInvestigator({ storage: await shopStorage(), model: new MockLlm(), queryOptions: { now: () => NOW } })
    expect(await investigator.startSession('from-before-restart')).toBe('from-before-restart')
    expect((await investigator.ask('q', { sessionId: 'from-before-restart' })).sessionId).toBe('from-before-restart')
  })
})

describe('chat handler sessions', () => {
  it('reports the session id and refuses a second question while the first is running', async () => {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new SlowMockLlm() })
    const turn = async (request: ChatRequest) => {
      const events: ChatEvent[] = []
      await handler.handle(request, (e) => events.push(e))
      return events
    }
    const first = await turn({ question: 'q1' })
    const status = first[0]
    expect(status).toMatchObject({ type: 'status', sessionId: expect.any(String) })
    const sessionId = status.type === 'status' ? status.sessionId : ''

    const running = turn({ question: 'q2', sessionId })
    await new Promise((r) => setTimeout(r, 5))
    expect(await turn({ question: 'q3', sessionId })).toEqual([{ type: 'error', message: 'this chat is still answering the previous question' }])
    expect((await running).at(-1)).toMatchObject({ type: 'report' })
    expect((await turn({ question: 'q4', sessionId })).at(-1)).toMatchObject({ type: 'report' })
  })
})

describe('chat handler sessions: races and timeouts', () => {
  const BUSY = { type: 'error', message: 'this chat is still answering the previous question' }

  async function setup(timeoutMs?: number) {
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new SlowMockLlm(), timeoutMs })
    const turn = async (request: ChatRequest) => {
      const events: ChatEvent[] = []
      await handler.handle(request, (e) => events.push(e))
      return events
    }
    return { handler, turn }
  }

  it('lets exactly one of two simultaneous requests for the same session through', async () => {
    const { turn } = await setup()
    const [status] = await turn({ question: 'q1' })
    const sessionId = status.type === 'status' ? status.sessionId : ''
    const [a, b] = await Promise.all([turn({ question: 'a', sessionId }), turn({ question: 'b', sessionId })])
    const refused = [a, b].filter((events) => events.length === 1 && events[0].type === 'error' && events[0].message === BUSY.message)
    expect(refused).toHaveLength(1)
    expect([a, b].find((events) => events !== refused[0])!.at(-1)).toMatchObject({ type: 'report' })
  })

  it('keeps a timed-out session busy until the background investigation really ends', async () => {
    const { turn } = await setup(60)
    const first = await turn({ question: 'q1' })
    expect(first.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('longer than') })
    const sessionId = first[0].type === 'status' ? first[0].sessionId : ''

    expect(await turn({ question: 'q2', sessionId })).toEqual([BUSY]) // still running in the background
    await new Promise((r) => setTimeout(r, 1500)) // ~15 mock turns × 20 ms, with margin
    const later = await turn({ question: 'q3', sessionId })
    expect(later[0]).toMatchObject({ type: 'status', sessionId })
  })
})

describe('collector passes sessions through', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('forwards sessionId and rejects malformed ones', async () => {
    const seen: ChatRequest[] = []
    const handle: ChatHandler = async (request, emit) => {
      seen.push(request)
      emit({ type: 'report', text: 'ok' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle } })
    const post = (body: object) => fetch(`${collector!.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await (await post({ question: 'a' })).text()
    await (await post({ question: 'b', sessionId: 'abc-123_x' })).text()
    expect(seen).toEqual([{ question: 'a' }, { question: 'b', sessionId: 'abc-123_x' }])
    expect((await post({ question: 'c', sessionId: '../etc' })).status).toBe(400)
    expect((await post({ question: 'c', sessionId: 42 })).status).toBe(400)
  })
})
