import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ registerOTel: [] as any[], exporter: [] as any[] }))

vi.mock('@vercel/otel', () => ({
  registerOTel: (config: unknown) => calls.registerOTel.push(config),
  OTLPHttpJsonTraceExporter: class {
    constructor(config: object) {
      calls.exporter.push({ ...config, protocol: 'http/json' })
    }
  },
  OTLPHttpProtoTraceExporter: class {
    constructor(config: object) {
      calls.exporter.push({ ...config, protocol: 'http/protobuf' })
    }
  },
}))

const { parseOtlpHeaders, register } = await import('../src/server.js')

const ENV = [
  'OBSERVE_SERVICE_NAME', 'OBSERVE_SERVICE_VERSION', 'OBSERVE_ENDPOINT', 'OBSERVE_API_KEY', 'VERCEL_GIT_COMMIT_SHA',
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
]

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
    expect(calls.exporter[0]).toEqual({ url: 'http://127.0.0.1:4318/v1/traces', headers: {}, protocol: 'http/json' })
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
    expect(calls.exporter[0]).toEqual({ url: 'https://observe.example.com/v1/traces', headers: { 'x-api-key': 'obs_live_1' }, protocol: 'http/json' })
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

describe('standard OTel exporter env vars', () => {
  it('OTEL_EXPORTER_OTLP_ENDPOINT is a base: /v1/traces is appended', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'https://otlp.example.com/')
    register()
    expect(calls.exporter[0].url).toBe('https://otlp.example.com/v1/traces')
  })

  it('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is the full URL, used as is, and wins over the base', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'https://otlp.example.com')
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://api.vendor.io/otlp/traces')
    register()
    expect(calls.exporter[0].url).toBe('https://api.vendor.io/otlp/traces')
    // The exporter's own fetches to a foreign backend are not traced either.
    expect(calls.registerOTel[0].instrumentationConfig.fetch.ignoreUrls).toEqual(['http://127.0.0.1:4318/', 'https://api.vendor.io/otlp/traces'])
  })

  it('OBSERVE_ENDPOINT wins over OTEL_* (next-observer dev sets it), and options win over everything', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://api.vendor.io/otlp/traces')
    vi.stubEnv('OBSERVE_ENDPOINT', 'http://127.0.0.1:4399')
    register()
    expect(calls.exporter[0].url).toBe('http://127.0.0.1:4399/v1/traces')
    register({ tracesUrl: 'https://custom.example.com/ingest' })
    expect(calls.exporter[1].url).toBe('https://custom.example.com/ingest')
  })

  it('headers: OTEL_EXPORTER_OTLP_HEADERS, then the traces-specific ones, then x-api-key, then options', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=Bearer%20abc, x-team = one ')
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'x-team=two')
    vi.stubEnv('OBSERVE_API_KEY', 'k1')
    register({ headers: { 'x-extra': 'e' } })
    expect(calls.exporter[0].headers).toEqual({ Authorization: 'Bearer abc', 'x-team': 'two', 'x-api-key': 'k1', 'x-extra': 'e' })
  })

  it('protocol: http/protobuf picks the protobuf exporter; unsupported values warn and fall back to JSON', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf')
    register()
    expect(calls.exporter[0].protocol).toBe('http/protobuf')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL', 'grpc')
    register()
    expect(calls.exporter[1].protocol).toBe('http/json')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"grpc" is not supported'))
    warn.mockRestore()

    register({ protocol: 'http/protobuf' })
    expect(calls.exporter[2].protocol).toBe('http/protobuf')
  })
})

describe('parseOtlpHeaders', () => {
  it('skips malformed entries instead of failing startup', () => {
    expect(parseOtlpHeaders('a=1,,=x,noequals, b = %E2%9C%93 ,c=%E0%A4%A')).toEqual({ a: '1', b: '✓', c: '%E0%A4%A' })
    expect(parseOtlpHeaders(undefined)).toEqual({})
  })
})
