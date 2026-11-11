import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeOtlpJson, RunCapture, startCollector, type NormalizedSpan } from '../src/collector/index.js'
import { performanceTrace, TRACE_ID } from './fixtures/performance-trace.js'
import { layoutRunTimeline, timelineDuration } from '../ui/src/lib/run-timeline.js'
import { summarizeRunTraces } from '../src/collector/run-traces.js'
const source = () => decodeOtlpJson(performanceTrace().json)[0]
const span = (id: number, parent: number | null = null): NormalizedSpan => ({ ...source(), spanId: id.toString(16).padStart(16, '0'), parentSpanId: parent === null ? null : parent.toString(16).padStart(16, '0') })
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

describe('recorded run timeline', () => {
  it('subtracts exact source timestamps before Number conversion and preserves event precision', () => {
    const s = source(), result = layoutRunTimeline([s])
    expect(result.precision).toBe('exact-nanoseconds')
    expect(result.durationMs).toBe(101 / 1e6)
    expect(result.rows[0].widthPct).toBe(100)
    expect(result.rows[0].events[0].offsetMs).toBe(61 / 1e6)
    expect(result.rows[0].events[0].exactUnixNano).toBe('1800000000123456850')
    expect(timelineDuration(s)).toBe('101 ns')
    expect(result.rows).toHaveLength(1) // commit is a point; no synthesized Profiler interval
  })
  it('retains real zero duration and explicit legacy precision without fabricated nanoseconds', () => {
    const zero = span(1); zero.endTimeUnixNano = zero.startTimeUnixNano; zero.durationMs = 0; zero.events = []
    const result = layoutRunTimeline([zero])
    expect(result.durationMs).toBe(0); expect(result.rows[0].widthPct).toBe(0)
    expect(timelineDuration(zero)).toBe('0 ns')
    const legacy = span(2); delete legacy.startTimeUnixNano; delete legacy.endTimeUnixNano; delete legacy.otlp
    const projection = layoutRunTimeline([legacy])
    expect(projection.precision).toBe('millisecond-projection')
    expect(projection.rows[0].events[0].exactUnixNano).toBeNull()
    expect(layoutRunTimeline([]).rows).toEqual([])
  })
  it('keeps missing parents, cyclic components and duplicate identities visible and bounded', () => {
    const a = span(1, 2), b = span(2, 1), orphan = span(3, 99)
    const result = layoutRunTimeline([a, b, orphan, a])
    expect(result.rows).toHaveLength(3); expect(result.cycleCount).toBe(1)
    expect(result.missingParents).toBe(1); expect(result.duplicateCount).toBe(1)
    expect(result.rows.find((r) => r.span.spanId === b.spanId)?.depth).toBe(1)
  })
  it('handles deep chains iteratively and does not join equal span IDs across traces', () => {
    const base = span(1)
    const chain = Array.from({ length: 12000 }, (_, i) => ({ ...base, events: [], spanId: (i + 1).toString(16).padStart(16, '0'), parentSpanId: i ? i.toString(16).padStart(16, '0') : null }))
    expect(layoutRunTimeline(chain).rows.at(-1)?.depth).toBe(11999)
    const foreign = { ...span(1), traceId: 'f'.repeat(32) }, child = span(2, 1)
    const result = layoutRunTimeline([foreign, child])
    expect(result.missingParents).toBe(1); expect(result.rows.every((r) => r.depth === 0)).toBe(true)
  })
  it('retains events outside span intervals on the axis and preserves source attributes', () => {
    const s = source(); s.otlp!.span.events![0].timeUnixNano = '1800000000123456990'
    s.events[0].attributes = { 'react.profiler.actualDuration': 35 }
    const result = layoutRunTimeline([s])
    expect(result.eventsOutsideSpan).toBe(1); expect(result.durationMs).toBe(201 / 1e6)
    expect(result.rows[0].events[0].offsetPct).toBe(100)
    expect(result.rows[0].events[0].event.attributes).toEqual({ 'react.profiler.actualDuration': 35 })
    expect(result.rows).toHaveLength(1)
  })
  it('summarizes full trace groups with missing parents and errors', () => {
    const a = span(1), b = span(2, 1), c = { ...span(3, 99), traceId: 'f'.repeat(32), status: 'error' as const }
    const groups = summarizeRunTraces([b, a, c])
    expect(groups).toHaveLength(2); expect(groups.find((t) => t.traceId === TRACE_ID)?.spanCount).toBe(2)
    expect(groups.find((t) => t.traceId === c.traceId)).toMatchObject({ errorCount: 1, missingParentCount: 1 })
  })
})
async function archive(count = 3) {
  const root = await mkdtemp(join(tmpdir(), 'observe-timeline-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const capture = new RunCapture(root)
  await capture.create('one', { experiment: 'C', variant: 'baseline', platform: 'react-web' })
  await capture.create('empty', { experiment: 'C', variant: 'baseline', platform: 'react-web' })
  const body = performanceTrace().json
  const first = body.resourceSpans![0].scopeSpans![0].spans![0]
  body.resourceSpans![0].scopeSpans![0].spans = Array.from({ length: count }, (_, i) => ({ ...first, spanId: (i + 1).toString(16).padStart(16, '0'), traceId: count < 10 && i === count - 1 ? 'f'.repeat(32) : TRACE_ID }))
  await capture.ingest('one', 'traces', 'json', Buffer.from(JSON.stringify(body)))
  await capture.finalize('one')
  return capture
}
describe('run-isolated trace reads', () => {
  it('paginates whole archive groups, bounds detail and isolates runs', async () => {
    const capture = await archive()
    const page = await capture.listTraces('one', { limit: 1 })
    expect(page.total).toBe(2); expect(page.nextOffset).toBe(1)
    expect((await capture.listTraces('one', { limit: 1, offset: 1 })).nextOffset).toBeNull()
    const detail = await capture.trace('one', TRACE_ID)
    expect(detail.spans).toHaveLength(2); expect(detail.truncated).toBe(false)
    expect(detail.missingParentCountInView).toBe(2)
    expect(await capture.listTraces('empty')).toMatchObject({ total: 0 })
    await expect(capture.trace('empty', TRACE_ID)).rejects.toMatchObject({ status: 404 })
    await expect(capture.trace('one', 'invalid')).rejects.toMatchObject({ status: 400 })
    await expect(capture.listTraces('one', { limit: 1001 })).rejects.toMatchObject({ status: 400 })
    await expect(capture.listTraces('one', { offset: -1 })).rejects.toMatchObject({ status: 400 })
  })
  it('reports partial trace details without truncating the trace index count', async () => {
    const capture = await archive(2001)
    const detail = await capture.trace('one', TRACE_ID)
    expect(detail.totalSpans).toBe(2001); expect(detail.spans).toHaveLength(2000); expect(detail.truncated).toBe(true)
    expect((await capture.listTraces('one')).traces[0].spanCount).toBe(2001)
  })
  it('HTTP trace routes require UI authentication and retain run isolation', async () => {
    const capture = await archive()
    const collector = await startCollector({ port: 0, capture, uiPassword: 'secret', uiDir: false })
    cleanup.push(() => collector.close())
    const headers = { Authorization: `Basic ${Buffer.from('reader:secret').toString('base64')}` }
    expect((await fetch(`${collector.url}/api/performance/runs/one/traces`)).status).toBe(401)
    const get = (path: string) => fetch(`${collector.url}/api/performance/runs/${path}`, { headers })
    expect(await (await get('one/traces')).json()).toMatchObject({ total: 2 })
    expect(await (await get(`one/traces/${TRACE_ID}`)).json()).toMatchObject({ totalSpans: 2 })
    expect((await get(`empty/traces/${TRACE_ID}`)).status).toBe(404)
    expect((await get('one/traces?limit=0')).status).toBe(400)
  })
})
