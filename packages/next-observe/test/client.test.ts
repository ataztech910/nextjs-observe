import { afterEach, describe, expect, it, vi } from 'vitest'
import { trace } from '@opentelemetry/api'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('resolveClientOptions', () => {
  it('exports to the same-origin proxy and marks the service as browser', async () => {
    vi.stubEnv('OBSERVE_SERVICE_NAME', undefined as unknown as string)
    const { resolveClientOptions } = await import('../src/client.js')
    expect(resolveClientOptions()).toEqual({ serviceName: 'next-app-browser', exportUrl: '/__observe/v1/traces' })
  })

  it('uses the service name inlined by withObserve, options win', async () => {
    vi.stubEnv('OBSERVE_SERVICE_NAME', 'shop')
    const { resolveClientOptions } = await import('../src/client.js')
    expect(resolveClientOptions().serviceName).toBe('shop-browser')
    expect(resolveClientOptions({ serviceName: 'x', exportUrl: 'http://c/v1/traces' })).toEqual({
      serviceName: 'x-browser',
      exportUrl: 'http://c/v1/traces',
    })
  })
})

describe('resolveClientOptions: version', () => {
  it('takes the version inlined by withObserve, the option wins, absent — none', async () => {
    vi.stubEnv('OBSERVE_SERVICE_VERSION', undefined as unknown as string)
    const { resolveClientOptions } = await import('../src/client.js')
    expect(resolveClientOptions()).not.toHaveProperty('serviceVersion')
    vi.stubEnv('OBSERVE_SERVICE_VERSION', 'v2')
    expect(resolveClientOptions().serviceVersion).toBe('v2')
    expect(resolveClientOptions({ serviceVersion: 'v9' }).serviceVersion).toBe('v9')
  })
})

describe('module side effect', () => {
  it('does not register a provider outside the browser (SSR import is safe)', async () => {
    const before = trace.getTracerProvider()
    await import('../src/client.js')
    expect(trace.getTracerProvider()).toBe(before)
  })
})

describe('flushWhenHidden', () => {
  it('sends the batched spans when the page is left or hidden — not when it becomes visible', async () => {
    const { flushWhenHidden } = await import('../src/client.js')
    let flushes = 0
    const provider = { forceFlush: async () => void flushes++ }
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    flushWhenHidden(provider, win, doc)

    win.dispatchEvent(new Event('pagehide'))
    expect(flushes).toBe(1)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flushes).toBe(2)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flushes).toBe(2)
  })

  it('a failing flush does not throw into the page', async () => {
    const { flushWhenHidden } = await import('../src/client.js')
    const win = new EventTarget()
    flushWhenHidden({ forceFlush: () => Promise.reject(new Error('offline')) }, win, Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    expect(() => win.dispatchEvent(new Event('pagehide'))).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })
})
