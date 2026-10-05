import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStorage, startCollector, type Collector } from '../src/collector/index.js'
import { demoSpans } from '../src/debug/demo.js'
import { createAgentQueries } from '../src/debug/queries.js'
import { findRegression, type VersionChange } from '../src/debug/regression.js'
import { NOW, shopStorage } from './fixtures/shop.js'

function change(operation: string, from: Partial<VersionChange['from']>, to: Partial<VersionChange['to']>, significant = false): VersionChange {
  const f = { version: 'v1', count: 30, p50Ms: 100, p95Ms: 200, errorRate: 0, ...from }
  const t = { version: 'v2', count: 30, p50Ms: 100, p95Ms: 200, errorRate: 0, ...to }
  return {
    service: 'shop',
    operation,
    from: f,
    to: t,
    p95Ratio: f.p95Ms > 0 ? Math.round((t.p95Ms / f.p95Ms) * 10) / 10 : null,
    errorRateDelta: Math.round((t.errorRate - f.errorRate) * 10) / 10,
    errorRateChangeSignificant: significant,
  }
}

describe('findRegression', () => {
  it('nothing changed → null', () => {
    expect(findRegression([change('GET /a', {}, {}), change('GET /b', {}, { p95Ms: 260 })])).toBeNull()
    expect(findRegression([])).toBeNull()
  })

  it('reports a latency regression with both versions and a ready question', () => {
    const r = findRegression([change('POST /api/checkout', { p95Ms: 320 }, { p95Ms: 2510 })])
    expect(r).toMatchObject({ kind: 'latency', version: 'v2', previousVersion: 'v1', operation: 'POST /api/checkout', p95Ratio: 7.8, from: { p95Ms: 320 }, to: { p95Ms: 2510 } })
    expect(r!.question).toBe('v2 looks like a regression: since v1 → v2, p95 of POST /api/checkout went from 320 ms to 2.51 s. What is causing it and where in the code?')
  })

  it('a big ratio on tiny numbers is not a regression', () => {
    expect(findRegression([change('GET /a', { p95Ms: 2 }, { p95Ms: 9 })])).toBeNull()
  })

  it('a big increase that is not even ×2 is not a regression either', () => {
    expect(findRegression([change('GET /a', { p95Ms: 1000 }, { p95Ms: 1300 })])).toBeNull()
  })

  it('needs enough requests on both sides, and real (not compile-time) latency', () => {
    expect(findRegression([change('GET /a', { count: 4 }, { p95Ms: 3000 })])).toBeNull()
    expect(findRegression([change('GET /a', {}, { p95Ms: 3000, count: 4 })])).toBeNull()
    expect(findRegression([change('GET /a', {}, { p95Ms: 3000, onlyColdStarts: true })])).toBeNull()
  })

  it('error rate: only a significant change of at least 10 points', () => {
    expect(findRegression([change('GET /a', {}, { errorRate: 0.3 }, false)])).toBeNull()
    expect(findRegression([change('GET /a', { errorRate: 0.02 }, { errorRate: 0.08 }, true)])).toBeNull()
    const r = findRegression([change('GET /products/[slug]', { errorRate: 0.02 }, { errorRate: 0.13 }, true)])
    expect(r).toMatchObject({ kind: 'errors', errorRateDelta: 0.11 })
    expect(r!.question).toContain('the error rate of GET /products/[slug] went from 2% to 13%')
  })

  it('names the route, not the function inside it — and the worst route first', () => {
    const r = findRegression([
      change('chargePayment', { p95Ms: 300 }, { p95Ms: 2490 }), // ×8.3, but an inner span
      change('GET /api/products', { p95Ms: 100 }, { p95Ms: 250 }), // ×2.5
      change('POST /api/checkout', { p95Ms: 320 }, { p95Ms: 2510 }), // ×7.8
    ])
    expect(r!.operation).toBe('POST /api/checkout')
    // Without any route the inner operation is still better than silence.
    expect(findRegression([change('chargePayment', { p95Ms: 300 }, { p95Ms: 2490 })])!.operation).toBe('chargePayment')
  })

  it('failing requests outrank slower ones of similar size', () => {
    const r = findRegression([change('GET /slow', { p95Ms: 100 }, { p95Ms: 300 }), change('GET /broken', {}, { errorRate: 0.3 }, true)])
    expect(r).toMatchObject({ operation: 'GET /broken', kind: 'errors' })
  })

  it('on the workshop shop: v2 slowed checkout down', async () => {
    const { changes } = await createAgentQueries(await shopStorage(), { now: () => NOW }).compareVersions({})
    expect(findRegression(changes)).toMatchObject({ kind: 'latency', version: 'v2', previousVersion: 'v1', operation: 'POST /api/checkout' })
  })
})

describe('GET /api/regression', () => {
  let collector: Collector | undefined
  afterEach(async () => {
    await collector?.close()
    collector = undefined
  })

  it('returns the regression of the latest deploy, or null without one', async () => {
    const storage = new MemoryStorage()
    collector = await startCollector({ port: 0, storage, uiDir: false })
    expect(await (await fetch(`${collector.url}/api/regression`)).json()).toEqual({ regression: null })
    await storage.insertSpans(demoSpans(Date.now()))
    const { regression } = (await (await fetch(`${collector.url}/api/regression`)).json()) as { regression: { version: string; operation: string } }
    expect(regression).toMatchObject({ version: 'v2', operation: 'POST /api/checkout' })
  })
})
