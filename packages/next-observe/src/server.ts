// Server/Edge instrumentation: `export { register } from 'next-observe/server'` in instrumentation.ts.
import { OTLPHttpJsonTraceExporter, registerOTel } from '@vercel/otel'
import { DEFAULT_ENDPOINT, DEFAULT_SERVICE_NAME } from './constants.js'

export interface ObserveServerOptions {
  /** OTel `service.name`. Default: OBSERVE_SERVICE_NAME, set by withObserve() from package.json. */
  serviceName?: string
  /** OTel `service.version` — lets agents compare deployments. Default: OBSERVE_SERVICE_VERSION or the Vercel commit SHA. */
  serviceVersion?: string
  /** Collector base URL. Default: OBSERVE_ENDPOINT or http://127.0.0.1:4318. */
  endpoint?: string
  /** Sent as `x-api-key`. Default: OBSERVE_API_KEY. */
  apiKey?: string
}

export function resolveServerOptions(options: ObserveServerOptions = {}) {
  const serviceVersion =
    options.serviceVersion ?? process.env.OBSERVE_SERVICE_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA
  return {
    serviceName: options.serviceName ?? process.env.OBSERVE_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    serviceVersion,
    endpoint: (options.endpoint ?? process.env.OBSERVE_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
    apiKey: options.apiKey ?? process.env.OBSERVE_API_KEY,
  }
}

// One id per server process (each `next dev` start, each serverless instance) — OTel's service.instance.id. The observer
// uses it to recognise a route's first request in a fresh process: in dev that request includes compiling the route.
// globalThis.crypto works in both the Node and the Edge runtime.
const INSTANCE_ID = globalThis.crypto.randomUUID()

// OTLP/JSON on purpose: our collector accepts JSON only until protobuf lands (Sprint 2, phase B).
export function register(options?: ObserveServerOptions): void {
  const { serviceName, serviceVersion, endpoint, apiKey } = resolveServerOptions(options)
  registerOTel({
    serviceName,
    attributes: { 'service.instance.id': INSTANCE_ID, ...(serviceVersion ? { 'service.version': serviceVersion } : {}) },
    // Next's /__observe rewrite forwards browser exports with fetch; tracing that adds a noise span per batch.
    instrumentationConfig: { fetch: { ignoreUrls: [`${endpoint}/`] } },
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    }),
  })
}
