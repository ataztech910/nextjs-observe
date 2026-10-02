// Where traces go and with which headers — shared by register() (server spans) and next-observe/proxy (browser spans),
// so both follow the same settings. No @vercel/otel import: the proxy route only needs this.
import { DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME } from './constants.js'

export type OtlpProtocol = 'http/json' | 'http/protobuf'

/** One place traces are sent to. */
export interface Destination {
  /** Full traces URL. */
  url: string
  headers?: Record<string, string>
  /** Default http/json. */
  protocol?: OtlpProtocol
}

export interface ObserveServerOptions {
  /** OTel `service.name`. Default: OBSERVE_SERVICE_NAME, set by withObserve() from package.json. */
  serviceName?: string
  /** OTel `service.version` — lets agents compare deployments. Default: OBSERVE_SERVICE_VERSION or the Vercel commit SHA. */
  serviceVersion?: string
  /** Observer base URL; traces go to `<endpoint>/v1/traces`. Default: OBSERVE_ENDPOINT. */
  endpoint?: string
  /** Full observer traces URL, used as is (for backends with a non-standard path). Wins over `endpoint`. */
  tracesUrl?: string
  /** Extra request headers for the observer, e.g. `{ Authorization: 'Bearer …' }`. */
  headers?: Record<string, string>
  /** Sent to the observer as `x-api-key`. Default: OBSERVE_API_KEY. */
  apiKey?: string
  /** Protocol for the observer. Default http/json. */
  protocol?: OtlpProtocol
  /** Full control: exactly these destinations, env vars for destinations are ignored. */
  destinations?: Destination[]
}

type Env = Record<string, string | undefined>

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/**
 * `OTEL_EXPORTER_OTLP_HEADERS` format: `key1=value1,key2=value2`, values percent-encoded. Malformed entries are skipped
 * rather than failing the app's startup.
 */
export function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const entry of (value ?? '').split(',')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const key = entry.slice(0, eq).trim()
    if (!key) continue
    try {
      headers[key] = decodeURIComponent(entry.slice(eq + 1).trim())
    } catch {
      headers[key] = entry.slice(eq + 1).trim()
    }
  }
  return headers
}

function resolveProtocol(value: string | undefined): OtlpProtocol {
  if (value === undefined || value === '' || value === 'http/json') return 'http/json'
  if (value === 'http/protobuf') return 'http/protobuf'
  // grpc needs a Node-only exporter; @vercel/otel exports over fetch (Node and Edge).
  console.warn(`[next-observe] OTLP protocol "${value}" is not supported, using http/json`)
  return 'http/json'
}

/**
 * Where traces go — every destination gets every span:
 * - the observer: `endpoint`/`tracesUrl` options or OBSERVE_ENDPOINT, with `x-api-key` and the `headers` option;
 * - an OTel backend: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT, with OTEL_EXPORTER_OTLP_*_HEADERS
 *   and _PROTOCOL — so a vendor's Authorization never goes to the observer, and the observer's key never to the vendor;
 * - neither set: the local observer (http://127.0.0.1:4318), where OTel's own default endpoint is too — so OTEL headers
 *   and protocol apply to it as well.
 * `destinations` replaces all of this.
 */
export function resolveDestinations(options: ObserveServerOptions = {}, env: Env = process.env): Destination[] {
  if (options.destinations) return options.destinations
  const otelHeaders = { ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS), ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS) }
  const otelProtocol = resolveProtocol(env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL)
  const apiKey = options.apiKey ?? env.OBSERVE_API_KEY
  const observerHeaders = { ...(apiKey ? { 'x-api-key': apiKey } : {}), ...options.headers }

  const base = options.endpoint ?? env.OBSERVE_ENDPOINT
  const observerUrl = options.tracesUrl ?? (base !== undefined ? `${trimSlash(base)}/v1/traces` : undefined)
  const otelUrl =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined ? `${trimSlash(env.OTEL_EXPORTER_OTLP_ENDPOINT)}/v1/traces` : undefined)

  if (observerUrl === undefined && otelUrl === undefined) {
    return [{ url: `${DEFAULT_ENDPOINT}/v1/traces`, headers: { ...otelHeaders, ...observerHeaders }, protocol: options.protocol ?? otelProtocol }]
  }
  const destinations: Destination[] = []
  if (observerUrl !== undefined) destinations.push({ url: observerUrl, headers: observerHeaders, protocol: options.protocol ?? 'http/json' })
  if (otelUrl !== undefined) {
    // Same URL from both sides (e.g. OBSERVE_ENDPOINT and OTEL_EXPORTER_OTLP_ENDPOINT both point at the observer): send once.
    const same = destinations.find((d) => d.url === otelUrl)
    if (same) same.headers = { ...otelHeaders, ...same.headers }
    else destinations.push({ url: otelUrl, headers: otelHeaders, protocol: otelProtocol })
  }
  return destinations
}

export function resolveServerOptions(options: ObserveServerOptions = {}, env: Env = process.env) {
  const base = options.endpoint ?? env.OBSERVE_ENDPOINT
  return {
    // Literal process.env.OBSERVE_SERVICE_NAME: Next inlines it at build (withObserve sets it from package.json); a lookup
    // through `env` is not inlined, and `next start` has no such variable at runtime.
    serviceName: options.serviceName ?? env.OBSERVE_SERVICE_NAME ?? process.env.OBSERVE_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    serviceVersion: options.serviceVersion ?? env.OBSERVE_SERVICE_VERSION ?? env.VERCEL_GIT_COMMIT_SHA,
    destinations: resolveDestinations(options, env),
    /** Base for the browser proxy's own fetches (withObserve forwards /__observe/* there): not traced either. */
    endpoint: trimSlash(base ?? DEFAULT_ENDPOINT),
  }
}
