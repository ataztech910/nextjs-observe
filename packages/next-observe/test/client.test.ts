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

describe('module side effect', () => {
  it('does not register a provider outside the browser (SSR import is safe)', async () => {
    const before = trace.getTracerProvider()
    await import('../src/client.js')
    expect(trace.getTracerProvider()).toBe(before)
  })
})
