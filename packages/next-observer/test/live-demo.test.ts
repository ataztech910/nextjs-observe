import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage, type NormalizedSpan } from '../src/collector/index.js'
import { demoSpans, liveDemoSpans, startLiveDemo } from '../src/debug/demo.js'
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

describe('the receipt email that v2 added', () => {
  const emails = (spans: NormalizedSpan[]) => spans.filter((s) => s.name === 'sendReceiptEmail')

  it('exists only in v2 and fails for guest checkouts — without failing the request', () => {
    const spans = demoSpans(NOW)
    expect(emails(spans).map((s) => s.serviceVersion)).toEqual(Array(30).fill('v2'))
    const failed = emails(spans).filter((s) => s.status === 'error')
    expect(failed).toHaveLength(5)
    // The checkout that carries a failed email still answered 200 and is not an error itself.
    const failedTraces = new Set(failed.map((s) => s.traceId))
    const requests = spans.filter((s) => failedTraces.has(s.traceId) && s.kind === 'server')
    expect(requests).toHaveLength(5)
    expect(requests.every((r) => r.status === 'unset' && r.attributes['http.status_code'] === 200)).toBe(true)
    // Fire-and-forget: it starts before the response and ends after it.
    const [email] = failed
    const request = requests.find((r) => r.traceId === email.traceId)!
    expect(email.startTimeMs).toBeLessThan(request.startTimeMs + request.durationMs)
    expect(email.startTimeMs + email.durationMs).toBeGreaterThan(request.startTimeMs + request.durationMs)
  })

  it('keeps failing in live traffic (every 6th tick), so the defect does not go stale — and the detector stays quiet about it', () => {
    const ticks = Array.from({ length: 12 }, (_, i) => liveDemoSpans(NOW + i * 2000, i))
    expect(ticks.map((spans) => emails(spans).filter((s) => s.status === 'error').length)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0])
    // Server requests are exactly what they were: the email adds no failed request for the detector to count.
    expect(roots(ticks.flat()).filter((s) => s.status === 'error').every((s) => s.name === 'GET /api/inventory/[id]')).toBe(true)
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
