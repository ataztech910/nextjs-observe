// Server/Edge instrumentation: `export { register } from 'next-observe/server'` in instrumentation.ts.
import { OTLPHttpJsonTraceExporter, OTLPHttpProtoTraceExporter, registerOTel } from '@vercel/otel'
import { resolveServerOptions, type ObserveServerOptions } from './exporter-config.js'

export { parseOtlpHeaders, resolveServerOptions, type ObserveServerOptions, type OtlpProtocol } from './exporter-config.js'

// One id per server process (each `next dev` start, each serverless instance) — OTel's service.instance.id. The observer
// uses it to recognise a route's first request in a fresh process: in dev that request includes compiling the route.
// globalThis.crypto works in both the Node and the Edge runtime.
const INSTANCE_ID = globalThis.crypto.randomUUID()

export function register(options?: ObserveServerOptions): void {
  const { serviceName, serviceVersion, tracesUrl, headers, protocol, endpoint } = resolveServerOptions(options)
  const Exporter = protocol === 'http/protobuf' ? OTLPHttpProtoTraceExporter : OTLPHttpJsonTraceExporter
  registerOTel({
    serviceName,
    attributes: { 'service.instance.id': INSTANCE_ID, ...(serviceVersion ? { 'service.version': serviceVersion } : {}) },
    // Exporting traces is a fetch too, and so is the /__observe proxy forwarding browser spans — neither is app traffic.
    instrumentationConfig: { fetch: { ignoreUrls: tracesUrl.startsWith(`${endpoint}/`) ? [`${endpoint}/`] : [`${endpoint}/`, tracesUrl] } },
    traceExporter: new Exporter({ url: tracesUrl, headers }),
    // @vercel/otel's 'auto' adds its own exporter whenever OTEL_EXPORTER_OTLP_*_ENDPOINT is set — every span would be
    // sent twice. Keep 'auto' only on Vercel with its collector (VERCEL_OTEL_ENDPOINTS: trace drains), where it adds just that.
    spanProcessors: process.env.VERCEL_OTEL_ENDPOINTS ? ['auto'] : [],
  })
}
