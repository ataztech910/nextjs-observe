import { readFileSync } from 'node:fs'
import type { LlmRequest, LlmResponse } from '@google/adk'
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_SPECIALISTS,
  createInvestigator,
  defineSpecialist,
  mergeSpecialists,
  MockLlm,
  TOOL_NAMES,
  type SpecialistSpec,
} from '../src/agents/index.js'
import { NOW, shopStorage } from './fixtures/shop.js'

const cache: SpecialistSpec = {
  name: 'cache_agent',
  description: 'Cache specialist: which deployment changed hit rates.',
  instruction: 'You look at versions only.',
  tools: ['get_services'],
}

describe('defineSpecialist', () => {
  it('accepts a valid spec, trims text and drops duplicate tools', () => {
    expect(defineSpecialist({ ...cache, description: '  d  ', tools: ['get_services', 'get_services'] })).toEqual({ ...cache, description: 'd', tools: ['get_services'] })
  })

  it.each([
    [{ ...cache, name: 'Cache Agent' }, 'name must be snake_case'],
    [{ ...cache, name: 'orchestrator' }, '"orchestrator" is reserved'],
    [{ ...cache, description: ' ' }, 'description must be a non-empty string'],
    [{ ...cache, instruction: undefined }, 'instruction must be a non-empty string'],
    [{ ...cache, tools: [] }, 'tools must list at least one of get_services'],
    [{ ...cache, tools: ['get_services', 'run_sql'] }, 'unknown tools run_sql — available: get_services'],
    [null, 'a specialist must be an object'],
  ])('rejects %#', (spec, message) => {
    expect(() => defineSpecialist(spec as SpecialistSpec)).toThrow(message)
  })
})

describe('mergeSpecialists', () => {
  it('replaces a built-in with the same name in place and appends new ones', () => {
    const latency = { ...BUILT_IN_SPECIALISTS[0], instruction: 'mine' }
    const merged = mergeSpecialists(BUILT_IN_SPECIALISTS, [cache, latency])
    expect(merged.map((s) => s.name)).toEqual(['latency_agent', 'error_agent', 'traffic_agent', 'cache_agent'])
    expect(merged[0].instruction).toBe('mine')
  })
})

// Records the system instruction each agent receives, then behaves like MockLlm.
class RecordingLlm extends MockLlm {
  instructions: string[] = []
  override async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.instructions.push(String(request.config?.systemInstruction ?? ''))
    yield* super.generateContentAsync(request)
  }
}

describe('investigator with project specialists', () => {
  it('runs only the given specialists, each with only its own tools', async () => {
    const latency = defineSpecialist({ ...BUILT_IN_SPECIALISTS[0], tools: ['compare_versions'] })
    const investigator = createInvestigator({ storage: await shopStorage(), model: new MockLlm(), queryOptions: { now: () => NOW }, specialists: [latency, cache] })
    const { steps } = await investigator.ask('What is going on?')
    expect(steps.map((s) => `${s.agent}:${s.tool}`)).toEqual([
      'orchestrator:latency_agent',
      'latency_agent:compare_versions',
      'orchestrator:cache_agent',
      'cache_agent:get_services',
    ])
  })

  it('gives specialists their instruction plus the shared rules, and lists them for the orchestrator', async () => {
    const model = new RecordingLlm()
    const investigator = createInvestigator({ storage: await shopStorage(), model, queryOptions: { now: () => NOW }, specialists: [cache] })
    await investigator.ask('What is going on?')
    const orchestrator = model.instructions.find((i) => i.includes('You coordinate'))!
    expect(orchestrator).toContain('- cache_agent: Cache specialist: which deployment changed hit rates.')
    expect(orchestrator).not.toContain('latency_agent')
    const specialist = model.instructions.find((i) => i.includes('You look at versions only.'))!
    expect(specialist).toContain('Use only facts returned by your tools')
    expect(specialist).toContain('never call other agents')
  })
})

describe('next-observe/agents (the types participants import)', () => {
  it('lists the same tools as nxo', () => {
    const source = readFileSync(new URL('../../next-observe/src/agents.ts', import.meta.url), 'utf8')
    const list = source.match(/TOOL_NAMES = \[([^\]]*)\]/)?.[1]
    expect(list?.match(/'([a-z_]+)'/g)?.map((t) => t.slice(1, -1))).toEqual([...TOOL_NAMES])
  })
})
