import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const exporter = new InMemorySpanExporter()

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }))
})

afterEach(() => {
  exporter.reset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
})

const load = async () => (await import('../src/runtime.js')).__observe
const spans = () => exporter.getFinishedSpans()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('server', () => {
  it('wraps a sync function in a span with code attributes', async () => {
    const observe = await load()
    expect(observe.run('add', 'function', 'lib.ts', () => 42)).toBe(42)
    expect(spans()).toHaveLength(1)
    expect(spans()[0].name).toBe('add')
    expect(spans()[0].attributes).toEqual({ 'code.function': 'add', 'code.filepath': 'lib.ts', 'observe.kind': 'function' })
  })

  it('ends an async span only after the promise settles', async () => {
    const observe = await load()
    const result = observe.run('load', 'function', 'lib.ts', async () => {
      await sleep(30)
      return 'ok'
    })
    expect(spans()).toHaveLength(0)
    expect(await result).toBe('ok')
    const [span] = spans()
    const durationMs = span.duration[0] * 1000 + span.duration[1] / 1e6
    expect(durationMs).toBeGreaterThanOrEqual(25)
  })

  it('records sync errors and rethrows', async () => {
    const observe = await load()
    expect(() => observe.run('boom', 'function', 'lib.ts', () => { throw new Error('bad') })).toThrow('bad')
    expect(spans()[0].status).toEqual({ code: SpanStatusCode.ERROR, message: 'bad' })
    expect(spans()[0].events[0].name).toBe('exception')
  })

  it('records async rejections and rethrows', async () => {
    const observe = await load()
    await expect(observe.run('boom', 'function', 'lib.ts', async () => { throw new Error('late') })).rejects.toThrow('late')
    expect(spans()[0].status.code).toBe(SpanStatusCode.ERROR)
  })

  it('nests spans: inner call is a child of the outer one', async () => {
    const observe = await load()
    await observe.run('Page', 'component', 'page.tsx', async () => {
      await observe.run('loadData', 'function', 'lib.ts', async () => sleep(5))
    })
    const page = spans().find((s) => s.name === 'render Page')!
    const load_ = spans().find((s) => s.name === 'loadData')!
    expect(load_.parentSpanContext?.spanId).toBe(page.spanContext().spanId)
    expect(load_.spanContext().traceId).toBe(page.spanContext().traceId)
  })
})

describe('browser', () => {
  it('aggregates component renders instead of creating a span per render', async () => {
    vi.stubGlobal('window', {})
    vi.useFakeTimers()
    const observe = await load()
    observe.run('Counter', 'component', 'counter.tsx', () => 'a')
    observe.run('Counter', 'component', 'counter.tsx', () => 'b')
    observe.run('Badge', 'component', 'counter.tsx', () => 'c')
    expect(spans()).toHaveLength(0)

    vi.advanceTimersByTime(5000)
    expect(spans()).toHaveLength(1)
    const [span] = spans()
    expect(span.name).toBe('react.renders')
    expect(span.attributes['react.render.Counter.count']).toBe(2)
    expect(span.attributes['react.render.Badge.count']).toBe(1)
  })

  it('still creates spans for plain functions', async () => {
    vi.stubGlobal('window', {})
    const observe = await load()
    observe.run('format', 'function', 'lib.ts', () => 'x')
    expect(spans().map((s) => s.name)).toEqual(['format'])
  })
})
