import { afterEach, describe, expect, it } from 'vitest'
import { startCollector, type ChatEvent, type ChatHandler, type Collector } from '../src/collector/index.js'

let collector: Collector | undefined
afterEach(async () => {
  await collector?.close()
  collector = undefined
})

const post = (body: unknown) =>
  fetch(`${collector!.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const lines = (text: string) => text.trim().split('\n').map((l) => JSON.parse(l) as ChatEvent)

describe('chat disabled (no agents)', () => {
  it('reports why on GET and answers 503 on POST', async () => {
    collector = await startCollector({ port: 0, uiDir: false })
    const info = await (await fetch(`${collector.url}/api/chat`)).json()
    expect(info).toEqual({ enabled: false, reason: expect.stringContaining('install @google/adk') })
    const res = await post({ question: 'why?' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('install @google/adk')
  })
})

describe('chat enabled', () => {
  it('reports the mode and streams events as NDJSON in order, with the trimmed question', async () => {
    const received: string[] = []
    const handle: ChatHandler = async (question, emit) => {
      received.push(question)
      emit({ type: 'status', mode: 'mock', text: 'Investigating…' })
      emit({ type: 'step', agent: 'latency_agent', tool: 'compare_versions', args: {} })
      emit({ type: 'report', text: 'chargePayment regressed in v2' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle } })
    expect(await (await fetch(`${collector.url}/api/chat`)).json()).toEqual({ enabled: true, mode: 'mock' })

    const res = await post({ question: '  why is checkout slow?  ' })
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(lines(await res.text()).map((e) => e.type)).toEqual(['status', 'step', 'report'])
    expect(received).toEqual(['why is checkout slow?'])
  })

  it('delivers each event while the agents are still working (live, not buffered)', async () => {
    let release!: () => void
    const handle: ChatHandler = async (_q, emit) => {
      emit({ type: 'step', agent: 'orchestrator', tool: 'latency_agent', args: {} })
      await new Promise<void>((resolve) => (release = resolve))
      emit({ type: 'report', text: 'done' })
    }
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle } })
    const res = await post({ question: 'q' })
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(JSON.parse(first.trim())).toMatchObject({ type: 'step', tool: 'latency_agent' })
    release()
    let rest = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value)
    expect(lines(rest)).toEqual([{ type: 'report', text: 'done' }])
  })

  it('turns a crashing handler into an error event', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'real', handle: async () => { throw new Error('kitana died') } } })
    const res = await post({ question: 'q' })
    expect(res.status).toBe(200)
    expect(lines(await res.text())).toEqual([{ type: 'error', message: 'kitana died' }])
  })

  it('rejects bad input with 400', async () => {
    collector = await startCollector({ port: 0, uiDir: false, chat: { mode: 'mock', handle: async () => {} } })
    expect((await post('{nope')).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ question: '   ' })).status).toBe(400)
    expect((await post({ question: 'x'.repeat(2001) })).status).toBe(400)
  })
})
