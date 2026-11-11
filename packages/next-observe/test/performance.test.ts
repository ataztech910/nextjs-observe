import { ROOT_CONTEXT, trace, type Meter, type Tracer } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it, vi } from 'vitest'
import { createPerformanceProbe } from '../src/performance.js'

function setup(mode: 'disabled' | 'diagnostic' | 'production_like' = 'diagnostic') {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const records: { name: string; value: number; attributes: unknown; context: unknown }[] = []
  const meter = { createHistogram: vi.fn((name: string) => ({ record(value: number, attributes: unknown, context: unknown) { records.push({ name, value, attributes, context }) } })) } as unknown as Meter
  let time = 10
  const now = vi.fn(() => time)
  const probe = createPerformanceProbe({ mode, source: { file: 'hook.ts', site: 'selected-memo-v1' }, meter, tracer: provider.getTracer('test'), now })
  return { exporter, records, meter, now, probe, tick: (n: number) => { time += n } }
}
describe('manual performance probe', () => {
  it('preserves values, cleanup and promise identities, measures only sync work, and declares outcome/endpoints', () => {
    const s = setup()
    const interaction = s.probe.startInteraction('search')
    const cleanup = () => {}
    expect(interaction.measureSync('memo', 'compute', () => { s.tick(12); return cleanup })).toBe(cleanup)
    const promise = Promise.resolve(7)
    expect(interaction.measureSync('promise factory', 'compute', () => promise)).toBe(promise)
    interaction.event('commit', { source: 'layout-effect' })
    s.tick(5)
    interaction.end('committed')
    interaction.end('cancelled')
    expect(s.records.map((r) => [r.name, r.value])).toEqual([['observe.perf.work.duration', 0.012], ['observe.perf.work.duration', 0], ['observe.perf.interaction.duration', 0.017]])
    const spans = s.exporter.getFinishedSpans()
    expect(spans).toHaveLength(3)
    expect(spans.find((x) => x.name === 'search')).toMatchObject({ attributes: { 'observe.perf.outcome': 'committed', 'observe.perf.endpoint': 'caller-declared' }, events: [{ name: 'commit' }] })
  })
  it('retains explicit parents for overlapping interactions and work resumed after awaits without global context', async () => {
    const s = setup()
    const a = s.probe.startInteraction('A')
    const b = s.probe.startInteraction('B')
    await Promise.resolve()
    a.measureSync('work A', 'compute', (ctx) => { expect(trace.getSpan(ctx)?.spanContext().spanId).not.toBe(trace.getSpan(a.context)?.spanContext().spanId) })
    b.measureSync('work B', 'reducer', () => 2)
    a.end('committed'); b.end('committed')
    const spans = s.exporter.getFinishedSpans()
    expect(spans.find((x) => x.name === 'work A')!.parentSpanContext?.spanId).toBe(trace.getSpan(a.context)!.spanContext().spanId)
    expect(spans.find((x) => x.name === 'work B')!.parentSpanContext?.spanId).toBe(trace.getSpan(b.context)!.spanContext().spanId)
    expect(trace.getSpan(a.context)!.spanContext().traceId).not.toBe(trace.getSpan(b.context)!.spanContext().traceId)
    expect(spans.filter((x) => x.name === 'A' || x.name === 'B').every((x) => !x.parentSpanContext)).toBe(true)
  })
  it('rethrows the original error and records failed work without hiding the exception', () => {
    const s = setup()
    const interaction = s.probe.startInteraction('fail')
    const error = new Error('bad callback')
    expect(() => interaction.measureSync('throw', 'compute', () => { s.tick(3); throw error })).toThrow(error)
    interaction.end('error')
    expect(s.records[0].attributes).toMatchObject({ outcome: 'error' })
    expect(s.exporter.getFinishedSpans()[0]).toMatchObject({ status: { code: 2 }, events: [{ name: 'exception' }] })
  })
  it('does no provider/clock work in disabled mode and still calls callbacks exactly once', () => {
    const meter = { createHistogram: vi.fn(() => { throw new Error('initialized') }) } as unknown as Meter
    const tracer = { startSpan: vi.fn(() => { throw new Error('initialized') }) } as unknown as Tracer
    const now = vi.fn(() => { throw new Error('clock') })
    const probe = createPerformanceProbe({ mode: 'disabled', source: { file: 'x', site: 'x' }, meter, tracer, now })
    const action = probe.startInteraction('disabled')
    const work = vi.fn(() => 42)
    expect(action.context).toBe(ROOT_CONTEXT)
    expect(action.measureSync('memo', 'compute', work)).toBe(42)
    action.event('commit'); action.end('committed')
    expect(work).toHaveBeenCalledOnce()
    expect(now).not.toHaveBeenCalled()
    expect(meter.createHistogram).not.toHaveBeenCalled()
    expect(tracer.startSpan).not.toHaveBeenCalled()
  })
  it('production_like retains aggregate metrics and interaction spans, omitting per-work spans', () => {
    const s = setup('production_like')
    const a = s.probe.startInteraction('action')
    a.measureSync('memo', 'compute', () => { s.tick(5) })
    a.end('committed')
    expect(s.records).toHaveLength(2)
    expect(s.exporter.getFinishedSpans().map((x) => x.name)).toEqual(['action'])
  })
  it('executes late work without attributing it to a completed interaction and ignores invalid clock durations', () => {
    const s = setup()
    const a = s.probe.startInteraction('action')
    a.measureSync('clock went backwards', 'compute', () => { s.tick(-1) })
    a.end('cancelled')
    const work = vi.fn(() => 3)
    expect(a.measureSync('late', 'compute', work)).toBe(3)
    expect(work).toHaveBeenCalledOnce()
    expect(s.records).toEqual([])
    expect(s.exporter.getFinishedSpans()).toHaveLength(2)
  })
})
