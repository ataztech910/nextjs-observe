import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ registerOTel: [] as any[], exporter: [] as any[] }))

vi.mock('@vercel/otel', () => ({
  registerOTel: (config: unknown) => calls.registerOTel.push(config),
  OTLPHttpJsonTraceExporter: class {
    constructor(config: unknown) {
      calls.exporter.push(config)
    }
  },
}))

const { register } = await import('../src/server.js')

const ENV = ['OBSERVE_SERVICE_NAME', 'OBSERVE_SERVICE_VERSION', 'OBSERVE_ENDPOINT', 'OBSERVE_API_KEY', 'VERCEL_GIT_COMMIT_SHA']

beforeEach(() => {
  calls.registerOTel.length = 0
  calls.exporter.length = 0
  for (const key of ENV) vi.stubEnv(key, undefined as unknown as string)
})
afterEach(() => vi.unstubAllEnvs())

describe('register', () => {
  it('works with zero config: local collector, default name, no version, no key', () => {
    register()
    expect(calls.registerOTel[0].serviceName).toBe('next-app')
    expect(calls.registerOTel[0].attributes).toEqual({ 'service.instance.id': expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(calls.exporter[0]).toEqual({ url: 'http://127.0.0.1:4318/v1/traces', headers: {} })
  })

  it('identifies the process with one service.instance.id — the same for every call in this process', () => {
    register()
    register({ serviceName: 'other' })
    const [first, second] = calls.registerOTel.map((c) => c.attributes['service.instance.id'])
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toBe(first)
  })

  it('does not trace fetches to the collector (the /__observe proxy forwarding browser spans)', () => {
    vi.stubEnv('OBSERVE_ENDPOINT', 'https://observe.example.com/')
    register()
    expect(calls.registerOTel[0].instrumentationConfig).toEqual({ fetch: { ignoreUrls: ['https://observe.example.com/'] } })
  })

  it('reads env vars', () => {
    vi.stubEnv('OBSERVE_SERVICE_NAME', 'shop')
    vi.stubEnv('OBSERVE_ENDPOINT', 'https://observe.example.com/')
    vi.stubEnv('OBSERVE_API_KEY', 'obs_live_1')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123')
    register()
    expect(calls.registerOTel[0].serviceName).toBe('shop')
    expect(calls.registerOTel[0].attributes).toEqual({ 'service.instance.id': expect.any(String), 'service.version': 'abc123' })
    expect(calls.exporter[0]).toEqual({ url: 'https://observe.example.com/v1/traces', headers: { 'x-api-key': 'obs_live_1' } })
  })

  it('prefers OBSERVE_SERVICE_VERSION over the Vercel SHA, and options over env', () => {
    vi.stubEnv('OBSERVE_SERVICE_VERSION', 'v2')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123')
    vi.stubEnv('OBSERVE_SERVICE_NAME', 'from-env')
    register({ serviceName: 'from-options', endpoint: 'http://collector:4318' })
    expect(calls.registerOTel[0].serviceName).toBe('from-options')
    expect(calls.registerOTel[0].attributes).toEqual({ 'service.instance.id': expect.any(String), 'service.version': 'v2' })
    expect(calls.exporter[0].url).toBe('http://collector:4318/v1/traces')
  })
})
