import type { NextConfig } from 'next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RULE_GLOB, withObserve } from '../src/config.js'

type Rule = { loaders: string[]; condition: { all: [unknown, { content: RegExp }] } }
const ourRule = (config: NextConfig) => config.turbopack!.rules![RULE_GLOB] as Rule

describe('withObserve', () => {
  it('adds a loader rule limited to non-foreign files containing the directive', () => {
    const rule = ourRule(withObserve({}))
    expect(rule.loaders).toHaveLength(1)
    expect(rule.loaders[0]).toMatch(/\/transform\/loader\.cjs$/)
    expect(rule.condition.all[0]).toEqual({ not: 'foreign' })
    const { content } = rule.condition.all[1]
    expect(content.test(`'use observe'`)).toBe(true)
    expect(content.test(`"use observe"`)).toBe(true)
    expect(content.test(`'use client'`)).toBe(false)
  })

  it('keeps the rest of the user config and other rules', () => {
    const svg = { loaders: ['@svgr/webpack'], as: '*.js' }
    const config = withObserve({
      reactStrictMode: false,
      turbopack: { resolveAlias: { a: 'b' }, rules: { '*.svg': svg } },
    })
    expect(config.reactStrictMode).toBe(false)
    expect(config.turbopack?.resolveAlias).toEqual({ a: 'b' })
    expect(config.turbopack?.rules?.['*.svg']).toBe(svg)
  })

  it('appends to an existing rule for the same glob instead of replacing it', () => {
    const userRule = { loaders: ['user-loader'] }
    const rules = withObserve({ turbopack: { rules: { [RULE_GLOB]: userRule } } }).turbopack!.rules!
    const collection = rules[RULE_GLOB] as unknown[]
    expect(collection).toHaveLength(2)
    expect(collection[0]).toBe(userRule)
  })

  it('does not mutate the input config', () => {
    const input: NextConfig = { turbopack: { rules: {} } }
    withObserve(input)
    expect(input.turbopack!.rules).toEqual({})
  })

  it('supports the function form of next.config', async () => {
    const wrapped = withObserve(async (phase: string) => ({ env: { PHASE: phase } }))
    const config = await wrapped('phase-production-build', { defaultConfig: {} })
    expect(config.env).toEqual({ PHASE: 'phase-production-build', OBSERVE_SERVICE_NAME: expect.any(String) })
    expect(ourRule(config)).toBeDefined()
  })
})

describe('withObserve: service name', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("defaults to the project's package.json name", () => {
    vi.stubEnv('OBSERVE_SERVICE_NAME', undefined as unknown as string)
    // tests run with cwd = this package
    expect(withObserve({}).env).toEqual({ OBSERVE_SERVICE_NAME: 'next-observe' })
  })

  it('env var and options override package.json, user env is kept', () => {
    vi.stubEnv('OBSERVE_SERVICE_NAME', 'from-env')
    expect(withObserve({ env: { A: '1' } }).env).toEqual({ A: '1', OBSERVE_SERVICE_NAME: 'from-env' })
    expect(withObserve({}, { serviceName: 'from-options' }).env?.OBSERVE_SERVICE_NAME).toBe('from-options')
  })
})

describe('withObserve: browser proxy rewrite', () => {
  afterEach(() => vi.unstubAllEnvs())
  const proxy = { source: '/__observe/:path*', destination: 'http://localhost:4318/:path*' }
  const user = { source: '/old', destination: '/new' }

  it('adds the proxy to beforeFiles when the user has no rewrites', async () => {
    vi.stubEnv('OBSERVE_ENDPOINT', undefined as unknown as string)
    expect(await withObserve({}).rewrites!()).toEqual({ beforeFiles: [proxy], afterFiles: [], fallback: [] })
  })

  it('keeps array-form user rewrites as afterFiles (same semantics as Next)', async () => {
    vi.stubEnv('OBSERVE_ENDPOINT', undefined as unknown as string)
    const config = withObserve({ rewrites: async () => [user] })
    expect(await config.rewrites!()).toEqual({ beforeFiles: [proxy], afterFiles: [user], fallback: [] })
  })

  it('prepends to object-form user rewrites', async () => {
    vi.stubEnv('OBSERVE_ENDPOINT', undefined as unknown as string)
    const config = withObserve({ rewrites: async () => ({ beforeFiles: [user], afterFiles: [], fallback: [user] }) })
    expect(await config.rewrites!()).toEqual({ beforeFiles: [proxy, user], afterFiles: [], fallback: [user] })
  })

  it('points the proxy at OBSERVE_ENDPOINT without a trailing slash', async () => {
    vi.stubEnv('OBSERVE_ENDPOINT', 'https://observe.example.com/')
    const { beforeFiles } = (await withObserve({}).rewrites!()) as { beforeFiles: unknown[] }
    expect(beforeFiles[0]).toEqual({ source: '/__observe/:path*', destination: 'https://observe.example.com/:path*' })
  })
})
