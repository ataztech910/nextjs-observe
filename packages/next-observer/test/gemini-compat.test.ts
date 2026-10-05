// Found with the first real Gemini key (2026-10-05): one `exclusiveMinimum` in a tool schema made the Gemini API answer
// 400 to every specialist, ADK swallowed the error, and the orchestrator reported "no data". Kitana never sends the
// schema to an API, so nothing showed it before.
import type { LlmResponse } from '@google/adk'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_SPECIALISTS, createChatHandler, createInvestigator, MockLlm } from '../src/agents/index.js'
import type { ChatEvent } from '../src/collector/index.js'
import { createAgentQueries } from '../src/debug/queries.js'
import { NOW, shopStorage } from './fixtures/shop.js'

// The fields of the Gemini API's Schema object (https://ai.google.dev/api/caching#Schema). Anything else is a 400.
const GEMINI_SCHEMA_FIELDS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'minProperties',
  'maxProperties', 'minLength', 'maxLength', 'pattern', 'example', 'anyOf', 'propertyOrdering', 'default', 'items', 'minimum', 'maximum',
])

function unknownFields(schema: unknown, path: string): string[] {
  if (!schema || typeof schema !== 'object') return []
  const found: string[] = []
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_FIELDS.has(key)) found.push(`${path}.${key}`)
    if (key === 'properties') for (const [name, sub] of Object.entries(value as Record<string, unknown>)) found.push(...unknownFields(sub, `${path}.${name}`))
    else if (key === 'items') found.push(...unknownFields(value, `${path}[]`))
    else if (key === 'anyOf') for (const sub of value as unknown[]) found.push(...unknownFields(sub, `${path}|`))
  }
  return found
}

/** MockLlm that remembers every tool declaration the agents send to the model. */
class DeclarationSpy extends MockLlm {
  declarations = new Map<string, { parameters?: unknown }>()
  async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
    for (const tool of Object.values(args[0].toolsDict ?? {})) this.declarations.set(tool.name, tool._getDeclaration() as { parameters?: unknown })
    yield* super.generateContentAsync(...args)
  }
}

describe('tool schemas the Gemini API accepts', () => {
  it('no tool of any agent uses a schema field Gemini does not know', async () => {
    const spy = new DeclarationSpy()
    await createInvestigator({ storage: await shopStorage(), model: spy, queryOptions: { now: () => NOW } }).ask('Why is checkout slow?')
    // The orchestrator's agent-tools and every data tool the built-in specialists use were seen.
    const expected = [...BUILT_IN_SPECIALISTS.map((s) => s.name), ...new Set(BUILT_IN_SPECIALISTS.flatMap((s) => s.tools))]
    expect([...spy.declarations.keys()].sort()).toEqual(expect.arrayContaining(expected.filter((name) => name !== 'get_trace').sort()))
    const problems = [...spy.declarations].flatMap(([name, d]) => unknownFields(d.parameters, name))
    expect(problems).toEqual([])
  })

  it('the checker itself catches what broke Gemini', () => {
    expect(unknownFields({ type: 'OBJECT', properties: { sinceMinutes: { type: 'NUMBER', minimum: 0, exclusiveMinimum: true } } }, 'get_errors')).toEqual(['get_errors.sinceMinutes.exclusiveMinimum'])
    expect(unknownFields({ type: 'OBJECT', properties: { ids: { type: 'ARRAY', items: { type: 'STRING', additionalProperties: false } } } }, 't')).toEqual(['t.ids[].additionalProperties'])
  })
})

describe('sinceMinutes without schema validation', () => {
  it('zero or a negative number from a model means "not given": the default window', async () => {
    const q = createAgentQueries(await shopStorage(), { now: () => NOW })
    const usual = await q.getOperationStats({})
    expect(usual.operations.length).toBeGreaterThan(0)
    expect(await q.getOperationStats({ sinceMinutes: 0 })).toEqual(usual)
    expect(await q.getOperationStats({ sinceMinutes: -30 })).toEqual(usual)
    // A real value still narrows the window.
    expect((await q.getOperationStats({ sinceMinutes: 0.001 })).operations).toEqual([])
  })
})

describe('a model error inside the specialists', () => {
  /** Answers the orchestrator like MockLlm, but fails every call made by a specialist (a request that offers data tools). */
  class FailsInSpecialists extends MockLlm {
    async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
      const tools = Object.keys(args[0].toolsDict ?? {})
      if (tools.some((name) => name.startsWith('get_'))) throw Object.assign(new Error(JSON.stringify({ error: { code: 400, message: 'Unknown name "exclusiveMinimum"', status: 'INVALID_ARGUMENT' } })), { status: 400 })
      yield* super.generateContentAsync(...args)
    }
  }

  it('is reported as an error — not as a confident "no data" report', async () => {
    const result = await createInvestigator({ storage: await shopStorage(), model: new FailsInSpecialists(), queryOptions: { now: () => NOW } }).ask('Why is checkout slow?')
    expect(result.text).toBe('')
    expect(result.error).toMatch(/^the specialists \(.*latency_agent.*\) returned nothing — the model call inside them failed/)
  })

  it('in the chat: an error event, and the real cause in the observer’s terminal', async () => {
    const lines: string[] = []
    const handler = await createChatHandler({ storage: await shopStorage(), env: {}, queryOptions: { now: () => NOW }, model: new FailsInSpecialists(), log: (l) => lines.push(l) })
    const events: ChatEvent[] = []
    await handler.handle({ question: 'Why is checkout slow?' }, (e) => events.push(e))
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('returned nothing') })
    expect(events.filter((e) => e.type === 'report')).toEqual([])
    expect(lines[0]).toBe('[next-observer] model error: The model provider rejected the request as invalid — this is a bug in next-observer or in a custom specialist, not something to retry. Provider: Unknown name "exclusiveMinimum"')
  })

  it('one specialist failing while others answer is still a report', async () => {
    class FailsInLatencyOnly extends MockLlm {
      async *generateContentAsync(...args: Parameters<MockLlm['generateContentAsync']>): AsyncGenerator<LlmResponse, void> {
        if (Object.keys(args[0].toolsDict ?? {}).includes('search_traces') && !Object.keys(args[0].toolsDict ?? {}).includes('get_errors')) throw new Error('boom')
        yield* super.generateContentAsync(...args)
      }
    }
    const result = await createInvestigator({ storage: await shopStorage(), model: new FailsInLatencyOnly(), queryOptions: { now: () => NOW } }).ask('Why is checkout slow?')
    expect(result.text).not.toBe('')
  })
})
