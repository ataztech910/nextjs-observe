import { FunctionTool, type LlmRequest } from '@google/adk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createInvestigator, getModel, MOCK_PREFIX, MockLlm, resolveAiMode, type InvestigationStep } from '../src/agents/index.js'
import { NOW, shopStorage } from './fixtures/shop.js'

describe('model selection', () => {
  it('defaults to mock and rejects unknown modes', () => {
    expect(resolveAiMode({})).toBe('mock')
    expect(resolveAiMode({ OBSERVE_AI: 'real' })).toBe('real')
    expect(() => resolveAiMode({ OBSERVE_AI: 'replay' })).toThrow('OBSERVE_AI must be "mock" or "real"')
  })

  it('mock → MockLlm, no network', async () => {
    expect(await getModel({})).toBeInstanceOf(MockLlm)
  })

  it('real + Gemini key → the model name from GEMINI_MODEL, never a hardcoded one', async () => {
    expect(await getModel({ OBSERVE_AI: 'real', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x' })).toBe('gemini-x')
    await expect(getModel({ OBSERVE_AI: 'real', GEMINI_API_KEY: 'k' })).rejects.toThrow('GEMINI_MODEL is not')
  })

  it('real without a Gemini key → Kitana', async () => {
    const model = await getModel({ OBSERVE_AI: 'real' })
    expect(model.constructor.name).toBe('KitanaLlm')
  })
})

describe('MockLlm', () => {
  const tool = (name: string, parameters: z.ZodObject) => new FunctionTool({ name, description: name, parameters, execute: async () => ({}) })
  async function turn(tools: FunctionTool[], contents: LlmRequest['contents'] = [{ role: 'user', parts: [{ text: 'why slow?' }] }]) {
    const request = { contents, toolsDict: Object.fromEntries(tools.map((t) => [t.name, t])), liveConnectConfig: {} } as LlmRequest
    const responses = []
    for await (const r of new MockLlm().generateContentAsync(request)) responses.push(r)
    return responses[0].content!.parts![0]
  }

  it('calls a tool without required args, passing {}', async () => {
    expect(await turn([tool('get_services', z.object({}))])).toEqual({ functionCall: { name: 'get_services', args: {} } })
  })

  it('passes the question to agent-as-tool (`request`)', async () => {
    expect(await turn([tool('latency_agent', z.object({ request: z.string() }))])).toEqual({ functionCall: { name: 'latency_agent', args: { request: 'why slow?' } } })
  })

  it('skips tools with other required args instead of calling them with garbage', async () => {
    const part = await turn([tool('get_trace', z.object({ traceId: z.string() }))])
    expect(part.functionCall).toBeUndefined()
    expect(part.text).toContain(MOCK_PREFIX)
  })

  it('does not call the same tool twice and ends with a summary of results', async () => {
    const part = await turn([tool('get_services', z.object({}))], [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ functionCall: { name: 'get_services', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_services', response: { services: ['shop'] } } }] },
    ])
    expect(part.text).toBe(`${MOCK_PREFIX} get_services: {"services":["shop"]}`)
  })
})

describe('investigator (mock model over the shop scenario)', () => {
  it('runs the orchestrator, every specialist and their tools, attributing each step', async () => {
    const seen: InvestigationStep[] = []
    const investigator = createInvestigator({
      storage: await shopStorage(),
      model: new MockLlm(),
      queryOptions: { now: () => NOW },
      onStep: (step) => seen.push(step),
    })
    const { text, steps, error } = await investigator.ask('Checkout is slow and product pages fail. What is going on?')

    expect(error).toBeUndefined()
    expect(text.startsWith(MOCK_PREFIX)).toBe(true)
    const calls = steps.map((s) => `${s.agent}:${s.tool}`)
    expect(calls).toEqual(
      expect.arrayContaining([
        'orchestrator:latency_agent',
        'orchestrator:error_agent',
        'orchestrator:traffic_agent',
        'latency_agent:get_operation_stats',
        'latency_agent:compare_versions',
        'latency_agent:search_traces',
        'error_agent:get_errors',
        // "Is this error new?" — the error agent compares versions too.
        'error_agent:compare_versions',
        'error_agent:search_traces',
        'traffic_agent:get_services',
        'traffic_agent:get_operation_stats',
      ]),
    )
    // get_trace needs a traceId the mock can't invent — it is skipped, not called with garbage.
    expect(calls.some((c) => c.endsWith(':get_trace'))).toBe(false)
    expect(seen).toEqual(steps)
  })

  it('passes the question to specialists and real tool data back up to the report', async () => {
    const investigator = createInvestigator({ storage: await shopStorage(), model: new MockLlm(), queryOptions: { now: () => NOW } })
    const { text, steps } = await investigator.ask('Why is checkout slow?')
    expect(steps.find((s) => s.tool === 'latency_agent')?.args).toEqual({ request: 'Why is checkout slow?' })
    expect(text).toContain('latency_agent')
    expect(text).toContain('POST /api/checkout')
  })

  it('keeps concurrent investigations on one instance apart (two chats at once)', async () => {
    const seen: InvestigationStep[] = []
    const investigator = createInvestigator({ storage: await shopStorage(), model: new MockLlm(), queryOptions: { now: () => NOW }, onStep: (s) => seen.push(s) })
    const single = await investigator.ask('warm-up')
    seen.length = 0
    const [a, b] = await Promise.all([investigator.ask('question A'), investigator.ask('question B')])
    for (const [result, question] of [[a, 'question A'], [b, 'question B']] as const) {
      expect(result.steps).toHaveLength(single.steps.length)
      const requests = result.steps.filter((s) => s.agent === 'orchestrator').map((s) => s.args.request)
      expect(new Set(requests)).toEqual(new Set([question]))
    }
    expect(seen).toHaveLength(2 * single.steps.length)
  })

  it('starts every investigation with a clean step list', async () => {
    const investigator = createInvestigator({ storage: await shopStorage(), model: new MockLlm(), queryOptions: { now: () => NOW } })
    const first = await investigator.ask('first')
    const second = await investigator.ask('second')
    expect(second.steps).toHaveLength(first.steps.length)
  })
})

describe('leaked tool calls', () => {
  it('recognises a bare tool-call JSON (also fenced) and nothing else', async () => {
    const { isLeakedToolCall } = await import('../src/agents/index.js')
    expect(isLeakedToolCall('{"tool_call":{"name":"latency_agent","args":{"request":"x"}}}')).toBe(true)
    expect(isLeakedToolCall('```json\n{"tool_call":{"name":"a","args":{}}}\n```')).toBe(true)
    expect(isLeakedToolCall('The diagnosis: chargePayment regressed in v2.')).toBe(false)
    expect(isLeakedToolCall('{"note":"not a tool call"}')).toBe(false)
    expect(isLeakedToolCall('{broken')).toBe(false)
    // real case: the model dropped the last closing brace — still a leaked call
    expect(isLeakedToolCall('{"tool_call":{"name":"latency_agent","args":{"request":"x"}}')).toBe(true)
  })

  it('turns a leaked call into an honest error instead of a report', async () => {
    const { BaseLlm } = await import('@google/adk')
    class LeakingLlm extends BaseLlm {
      constructor() {
        super({ model: 'leaking' })
      }
      async *generateContentAsync() {
        yield { content: { role: 'model', parts: [{ text: '{"tool_call":{"name":"latency_agent","args":{"request":"x"}}}' }] }, turnComplete: true }
      }
      async connect(): Promise<never> {
        throw new Error('no live')
      }
    }
    const investigator = createInvestigator({ storage: await shopStorage(), model: new LeakingLlm(), queryOptions: { now: () => NOW } })
    const result = await investigator.ask('why?')
    expect(result.text).toBe('')
    expect(result.error).toContain('did not finish the report')
  })
})
