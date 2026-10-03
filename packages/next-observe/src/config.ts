import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import { BROWSER_PROXY_PATH, DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME, PROXY_ROUTE_PATH } from './constants.js'

type TurbopackRules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>
type RuleCollection = TurbopackRules[string]
type Rewrites = Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>>
type Rewrite = Extract<Rewrites, unknown[]>[number]
type ConfigFunction = (phase: string, context: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>

export interface ObserveOptions {
  /** OTel `service.name`. Default: OBSERVE_SERVICE_NAME, else `name` from the project's package.json. */
  serviceName?: string
  /** OTel `service.version` for browser spans. Default: OBSERVE_SERVICE_VERSION, else the Vercel commit SHA. */
  serviceVersion?: string
  /** Collector base URL the browser proxy points to. Default: OBSERVE_ENDPOINT or http://127.0.0.1:4318. */
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

const ROUTE_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx', 'mts', 'mjs']

/** The opt-in runtime proxy route (`export { POST } from 'next-observe/proxy'`), in app/ or src/app/. */
export function findProxyRoute(root: string = process.cwd()): string | undefined {
  for (const appDir of ['app', join('src', 'app')]) {
    for (const ext of ROUTE_EXTENSIONS) {
      const file = join(root, appDir, 'api', 'next-observe', '[...path]', `route.${ext}`)
      if (existsSync(file)) return file
    }
  }
  return undefined
}

export function resolveObserveOptions(options: ObserveOptions = {}) {
  return {
    serviceName: options.serviceName ?? process.env.OBSERVE_SERVICE_NAME ?? packageName() ?? DEFAULT_SERVICE_NAME,
    serviceVersion: options.serviceVersion ?? process.env.OBSERVE_SERVICE_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA,
    endpoint: (options.endpoint ?? process.env.OBSERVE_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
  }
}

// The browser exports to its own origin, so no CORS and no public endpoint env var. Without the proxy route this is a
// rewrite straight to the collector (destination fixed at `next build`); with it, an internal rewrite to the route,
// which reads the destination and headers at runtime.
function withProxy(userRewrites: NextConfig['rewrites'], endpoint: string, route: boolean): NonNullable<NextConfig['rewrites']> {
  const destination = route ? `${PROXY_ROUTE_PATH}/:path*` : `${endpoint}/:path*`
  const proxy: Rewrite = { source: `${BROWSER_PROXY_PATH}/:path*`, destination }
  return async () => {
    const user = await userRewrites?.()
    if (!user) return { beforeFiles: [proxy], afterFiles: [], fallback: [] }
    if (Array.isArray(user)) return { beforeFiles: [proxy], afterFiles: user, fallback: [] }
    return { ...user, beforeFiles: [proxy, ...(user.beforeFiles ?? [])] }
  }
}

function apply(config: NextConfig, options: ObserveOptions): NextConfig {
  const { serviceName, serviceVersion, endpoint } = resolveObserveOptions(options)
  const rules: TurbopackRules = { ...config.turbopack?.rules }
  rules[RULE_GLOB] = addRule(rules[RULE_GLOB])
  return {
    ...config,
    // Inlined at build time into server and browser bundles.
    // The version too: browser spans need it for "which deployment?" (the server reads it at runtime as well).
    env: { ...config.env, OBSERVE_SERVICE_NAME: serviceName, ...(serviceVersion ? { OBSERVE_SERVICE_VERSION: serviceVersion } : {}) },
    rewrites: withProxy(config.rewrites, endpoint, findProxyRoute() !== undefined),
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
