// Server/Edge instrumentation: `export { register } from 'next-observe/server'` in instrumentation.ts.
import type { Context } from '@opentelemetry/api'
import { BatchSpanProcessor, type ReadableSpan, type Span, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
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

/**
 * How often server spans are sent. OTel's default is 5 s — in `next dev` that means clicking in the app and waiting
 * seconds for the server half of the trace to appear in the observer. Production keeps the default: fewer requests.
 */
export function serverBatchDelayMs(nodeEnv: string | undefined = process.env.NODE_ENV): number {
  return nodeEnv === 'development' ? 1000 : 5000
}

function exporterFor({ url, headers = {}, protocol = 'http/json' }: Destination) {
  return protocol === 'http/protobuf' ? new OTLPHttpProtoTraceExporter({ url, headers }) : new OTLPHttpJsonTraceExporter({ url, headers })
}

/**
 * `next dev` checks npm for a newer Next.js once, when the first browser connects to HMR. Who traces that fetch depends
 * on timing: after register() @vercel/otel's fetch instrumentation does (it sets NEXT_OTEL_FETCH_DISABLED), but when
 * an open tab reconnects while the server is still starting, Next traces it itself (scope next.js, AppRender.fetch)
 * and `ignoreUrls` never sees it. Both carry the URL, so the span is dropped before export — in development only: a
 * production app talking to npm is its own traffic.
 */
export function isDevNoise(span: Pick<ReadableSpan, 'attributes'>, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  if (nodeEnv !== 'development') return false
  const url = span.attributes['http.url'] ?? span.attributes['url.full']
  return typeof url === 'string' && url.startsWith('https://registry.npmjs.org/')
}

/** Passes spans to `inner` except those `drop` rejects. */
export class DropSpans implements SpanProcessor {
  constructor(
    private readonly inner: SpanProcessor,
    private readonly drop: (span: ReadableSpan) => boolean,
  ) {}
  onStart(span: Span, context: Context): void {
    this.inner.onStart(span, context)
  }
  onEnd(span: ReadableSpan): void {
    if (!this.drop(span)) this.inner.onEnd(span)
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

export function register(options?: ObserveServerOptions): void {
  const { serviceName, serviceVersion, destinations, endpoint } = resolveServerOptions(options)
  const foreign = destinations.map((d) => d.url).filter((url) => !url.startsWith(`${endpoint}/`))
  registerOTel({
    serviceName,
    attributes: { 'service.instance.id': INSTANCE_ID, ...(serviceVersion ? { 'service.version': serviceVersion } : {}) },
    // Exporting traces is a fetch too, and so is the /__observe proxy forwarding browser spans — neither is app traffic.
    instrumentationConfig: { fetch: { ignoreUrls: [`${endpoint}/`, ...foreign] } },
    // One batch processor per destination, every span goes to each. No `traceExporter`, and no 'auto' — @vercel/otel's
    // 'auto' adds its own exporter whenever OTEL_EXPORTER_OTLP_*_ENDPOINT is set, and every span would go twice. Kept only
    // on Vercel with its collector (VERCEL_OTEL_ENDPOINTS: trace drains), where it adds just that.
    spanProcessors: [...(process.env.VERCEL_OTEL_ENDPOINTS ? (['auto'] as const) : []), ...destinations.map((d) => new DropSpans(new BatchSpanProcessor(exporterFor(d), { scheduledDelayMillis: serverBatchDelayMs() }), isDevNoise))],
  })
}
