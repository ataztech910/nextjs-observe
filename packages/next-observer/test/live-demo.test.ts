import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage, type NormalizedSpan } from '../src/collector/index.js'
import { liveDemoSpans, startLiveDemo } from '../src/debug/demo.js'
import { AnomalyDetector } from '../src/debug/detector.js'

const NOW = 1_800_000_000_000
const roots = (spans: NormalizedSpan[]) => spans.filter((s) => s.kind === 'server')

describe('liveDemoSpans', () => {
  it('is v2 traffic with the same three bugs: slow payment, 3 in 10 inventory failures, the catalog N+1 every 5th tick', () => {
    const ticks = Array.from({ length: 10 }, (_, i) => liveDemoSpans(NOW + i * 2000, i))
    const all = ticks.flat()
    expect(new Set(all.map((s) => s.serviceVersion))).toEqual(new Set(['v2']))
    expect(all.filter((s) => s.name === 'chargePayment').every((s) => s.durationMs >= 1400)).toBe(true)
    expect(all.filter((s) => s.name === 'GET /api/inventory/[id]' && s.status === 'error')).toHaveLength(3)
    expect(all.filter((s) => s.name === 'GET /api/products')).toHaveLength(2)
    expect(all.filter((s) => s.name === 'db.query')).toHaveLength(10)
    expect(new Set(all.map((s) => s.spanId)).size).toBe(all.length)
    expect(roots(ticks[0]).every((s) => s.startTimeMs >= NOW)).toBe(true)
  })
})

describe('startLiveDemo', () => {
  afterEach(() => vi.useRealTimers())

  it('inserts a tick every interval, feeds the detector the same spans, and stops', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const observed: NormalizedSpan[] = []
    const stop = startLiveDemo({ storage, detector: { observe: (spans) => observed.push(...spans) }, intervalMs: 2000, now: () => NOW })
    await vi.advanceTimersByTimeAsync(6000)
    const afterThree = await storage.count()
    expect(afterThree).toBeGreaterThan(0)
    expect(observed).toHaveLength(afterThree)
    stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await storage.count()).toBe(afterThree)
  })

  it('gives the detector a real anomaly to find on its own: inventory fails 30% of the time', () => {
    let clock = NOW
    const detector = new AnomalyDetector({ now: () => clock })
    const found = []
    for (let tick = 0; tick < 10; tick++) {
      clock = NOW + tick * 2000
      detector.observe(liveDemoSpans(clock, tick))
      found.push(...detector.check())
    }
    const kinds = found.map((a) => [a.type, a.subject?.operation ?? 'all'])
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['high_error_rate', 'GET /api/inventory/[id]'],
        // v2's payment is always slow — the detector sees that too.
        ['high_latency', 'all'],
      ]),
    )
    // Spread-out failures are an inventory problem, not an app-wide error spike.
    expect(kinds).not.toContainEqual(['high_error_rate', 'all'])
  })
})

describe('demo ids', () => {
  it('look like real ids (no zero padding), are unique, and the same on every run', async () => {
    const { demoSpans } = await import('../src/debug/demo.js')
    const spans = demoSpans(NOW)
    expect(spans.every((s) => /^[0-9a-f]{32}$/.test(s.traceId) && /^[0-9a-f]{16}$/.test(s.spanId))).toBe(true)
    expect(spans.filter((s) => s.traceId.startsWith('00000000')).length).toBeLessThan(2)
    expect(new Set(spans.map((s) => s.spanId)).size).toBe(spans.length)
    expect(demoSpans(NOW).map((s) => s.traceId)).toEqual(spans.map((s) => s.traceId))
  })
})
