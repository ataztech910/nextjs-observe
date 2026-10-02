// Where traces go and with which headers — shared by register() (server spans) and next-observe/proxy (browser spans),
// so both follow the same settings. No @vercel/otel import: the proxy route only needs this.
import { DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME } from './constants.js'

export type OtlpProtocol = 'http/json' | 'http/protobuf'

export interface ObserveServerOptions {
  /** OTel `service.name`. Default: OBSERVE_SERVICE_NAME, set by withObserve() from package.json. */
  serviceName?: string
  /** OTel `service.version` — lets agents compare deployments. Default: OBSERVE_SERVICE_VERSION or the Vercel commit SHA. */
  serviceVersion?: string
  /** Base URL; traces go to `<endpoint>/v1/traces`. Default: OBSERVE_ENDPOINT, OTel env vars, http://127.0.0.1:4318. */
  endpoint?: string
  /** Full traces URL, used as is (for backends with a non-standard path). Wins over `endpoint`. */
  tracesUrl?: string
  /** Extra request headers, e.g. `{ Authorization: 'Bearer …' }`. Merged over OTEL_EXPORTER_OTLP_(TRACES_)HEADERS. */
  headers?: Record<string, string>
  /** Sent as `x-api-key`. Default: OBSERVE_API_KEY. */
  apiKey?: string
  /** Default: OTEL_EXPORTER_OTLP_(TRACES_)PROTOCOL, else http/json. */
  protocol?: OtlpProtocol
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
 * Where traces go. Precedence: options → OBSERVE_* → standard OTel env vars → local observer. OBSERVE_ENDPOINT wins over
 * OTEL_* so a global OTEL_EXPORTER_OTLP_ENDPOINT can't steal traces from `next-observer dev`, which sets OBSERVE_ENDPOINT.
 */
export function resolveServerOptions(options: ObserveServerOptions = {}, env: Env = process.env) {
  const serviceVersion = options.serviceVersion ?? env.OBSERVE_SERVICE_VERSION ?? env.VERCEL_GIT_COMMIT_SHA
  const base = options.endpoint ?? env.OBSERVE_ENDPOINT
  const tracesUrl =
    options.tracesUrl ??
    (base !== undefined ? `${trimSlash(base)}/v1/traces` : undefined) ??
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    `${trimSlash(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_ENDPOINT)}/v1/traces`
  const apiKey = options.apiKey ?? env.OBSERVE_API_KEY
  const headers = {
    ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    ...parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...options.headers,
  }
  return {
    // Literal process.env.OBSERVE_SERVICE_NAME: Next inlines it at build (withObserve sets it from package.json); a lookup
    // through `env` is not inlined, and `next start` has no such variable at runtime.
    serviceName: options.serviceName ?? env.OBSERVE_SERVICE_NAME ?? process.env.OBSERVE_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    serviceVersion,
    tracesUrl,
    headers,
    protocol: options.protocol ?? resolveProtocol(env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL),
    /** Base for the browser proxy's own fetches (withObserve forwards /__observe/* there): not traced either. */
    endpoint: trimSlash(base ?? DEFAULT_ENDPOINT),
  }
}
