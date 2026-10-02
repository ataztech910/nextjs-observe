// Server/Edge instrumentation: `export { register } from 'next-observe/server'` in instrumentation.ts.
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPHttpJsonTraceExporter, OTLPHttpProtoTraceExporter, registerOTel } from '@vercel/otel'
import { resolveServerOptions, type Destination, type ObserveServerOptions } from './exporter-config.js'

export {
  parseOtlpHeaders,
  resolveDestinations,
  resolveServerOptions,
  type Destination,
  type ObserveServerOptions,
  type OtlpProtocol,
} from './exporter-config.js'

// One id per server process (each `next dev` start, each serverless instance) — OTel's service.instance.id. The observer
// uses it to recognise a route's first request in a fresh process: in dev that request includes compiling the route.
// globalThis.crypto works in both the Node and the Edge runtime.
const INSTANCE_ID = globalThis.crypto.randomUUID()

function exporterFor({ url, headers = {}, protocol = 'http/json' }: Destination) {
  return protocol === 'http/protobuf' ? new OTLPHttpProtoTraceExporter({ url, headers }) : new OTLPHttpJsonTraceExporter({ url, headers })
}

export function register(options?: ObserveServerOptions): void {
  const { serviceName, serviceVersion, destinations, endpoint } = resolveServerOptions(options)
  const foreign = destinations.map((d) => d.url).filter((url) => !url.startsWith(`${endpoint}/`))
  // `next dev` checks npm for a newer Next.js — a fetch from the server process that is not the app's traffic.
  const devNoise = process.env.NODE_ENV === 'development' ? ['https://registry.npmjs.org/'] : []
  registerOTel({
    serviceName,
    attributes: { 'service.instance.id': INSTANCE_ID, ...(serviceVersion ? { 'service.version': serviceVersion } : {}) },
    // Exporting traces is a fetch too, and so is the /__observe proxy forwarding browser spans — neither is app traffic.
    instrumentationConfig: { fetch: { ignoreUrls: [`${endpoint}/`, ...foreign, ...devNoise] } },
    // One batch processor per destination, every span goes to each. No `traceExporter`, and no 'auto' — @vercel/otel's
    // 'auto' adds its own exporter whenever OTEL_EXPORTER_OTLP_*_ENDPOINT is set, and every span would go twice. Kept only
    // on Vercel with its collector (VERCEL_OTEL_ENDPOINTS: trace drains), where it adds just that.
    spanProcessors: [...(process.env.VERCEL_OTEL_ENDPOINTS ? (['auto'] as const) : []), ...destinations.map((d) => new BatchSpanProcessor(exporterFor(d)))],
  })
}
