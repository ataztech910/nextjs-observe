import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import { BROWSER_PROXY_PATH, DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME } from './constants.js'

type TurbopackRules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>
type RuleCollection = TurbopackRules[string]
type Rewrites = Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>>
type Rewrite = Extract<Rewrites, unknown[]>[number]
type ConfigFunction = (phase: string, context: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>

export interface ObserveOptions {
  /** OTel `service.name`. Default: OBSERVE_SERVICE_NAME, else `name` from the project's package.json. */
  serviceName?: string
  /** Collector base URL the browser proxy points to. Default: OBSERVE_ENDPOINT or http://localhost:4318. */
  endpoint?: string
}

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

function packageName(): string | undefined {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name
  } catch {
    return undefined
  }
}

export function resolveObserveOptions(options: ObserveOptions = {}) {
  return {
    serviceName: options.serviceName ?? process.env.OBSERVE_SERVICE_NAME ?? packageName() ?? DEFAULT_SERVICE_NAME,
    endpoint: (options.endpoint ?? process.env.OBSERVE_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
  }
}

// The browser exports to its own origin; this proxies it to the collector — no CORS, no public endpoint env var.
function withProxy(userRewrites: NextConfig['rewrites'], endpoint: string): NonNullable<NextConfig['rewrites']> {
  const proxy: Rewrite = { source: `${BROWSER_PROXY_PATH}/:path*`, destination: `${endpoint}/:path*` }
  return async () => {
    const user = await userRewrites?.()
    if (!user) return { beforeFiles: [proxy], afterFiles: [], fallback: [] }
    if (Array.isArray(user)) return { beforeFiles: [proxy], afterFiles: user, fallback: [] }
    return { ...user, beforeFiles: [proxy, ...(user.beforeFiles ?? [])] }
  }
}

function apply(config: NextConfig, options: ObserveOptions): NextConfig {
  const { serviceName, endpoint } = resolveObserveOptions(options)
  const rules: TurbopackRules = { ...config.turbopack?.rules }
  rules[RULE_GLOB] = addRule(rules[RULE_GLOB])
  return {
    ...config,
    // Inlined at build time into server and browser bundles.
    env: { ...config.env, OBSERVE_SERVICE_NAME: serviceName },
    rewrites: withProxy(config.rewrites, endpoint),
    turbopack: { ...config.turbopack, rules },
  }
}

export function withObserve(config: NextConfig, options?: ObserveOptions): NextConfig
export function withObserve(config: ConfigFunction, options?: ObserveOptions): ConfigFunction
export function withObserve(config: NextConfig | ConfigFunction = {}, options: ObserveOptions = {}): NextConfig | ConfigFunction {
  if (typeof config === 'function') {
    return async (phase, context) => apply(await config(phase, context), options)
  }
  return apply(config, options)
}
