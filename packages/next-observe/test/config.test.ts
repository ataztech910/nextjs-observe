import type { NextConfig } from 'next'
import { describe, expect, it } from 'vitest'
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
    expect(config.env).toEqual({ PHASE: 'phase-production-build' })
    expect(ourRule(config)).toBeDefined()
  })
})
