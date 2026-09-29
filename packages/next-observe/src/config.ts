import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

type TurbopackRules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>
type RuleCollection = TurbopackRules[string]
type ConfigFunction = (phase: string, context: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>

export const RULE_GLOB = '*.{js,jsx,ts,tsx,mjs,mts}'

const loaderPath = fileURLToPath(new URL('./transform/loader.cjs', import.meta.url))

const observeRule = {
  // 'foreign' = node_modules and Next internals; content filter keeps the loader off files without the directive.
  condition: { all: [{ not: 'foreign' as const }, { content: /['"]use observe['"]/ }] },
  loaders: [loaderPath],
}

function addRule(existing: RuleCollection | undefined): RuleCollection {
  if (existing === undefined) return observeRule
  return [...(Array.isArray(existing) ? existing : [existing]), observeRule]
}

function apply(config: NextConfig): NextConfig {
  const rules: TurbopackRules = { ...config.turbopack?.rules }
  rules[RULE_GLOB] = addRule(rules[RULE_GLOB])
  return { ...config, turbopack: { ...config.turbopack, rules } }
}

export function withObserve(config: NextConfig): NextConfig
export function withObserve(config: ConfigFunction): ConfigFunction
export function withObserve(config: NextConfig | ConfigFunction = {}): NextConfig | ConfigFunction {
  if (typeof config === 'function') {
    return async (phase, context) => apply(await config(phase, context))
  }
  return apply(config)
}
