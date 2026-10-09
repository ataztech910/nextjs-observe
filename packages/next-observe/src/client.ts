// Browser instrumentation: `import 'next-observe/client'` in instrumentation-client.ts.
// Next runs that file before hydration, so the provider exists before any component renders.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { captureBrowserErrors, markFailedFetch, markFailedXhr } from './browser-errors.js'
import { BROWSER_PROXY_PATH, DEFAULT_SERVICE_NAME } from './constants.js'

export interface ObserveClientOptions {
  serviceName?: string
  /** Default: OBSERVE_SERVICE_VERSION, inlined at build time by withObserve(). */
  serviceVersion?: string
  /** Where spans are POSTed. Default: same-origin proxy that withObserve() rewrites to the collector. */
  exportUrl?: string
  /**
   * Record uncaught errors, unhandled promise rejections, console.error calls and resources that failed to load as
   * failed spans. Default true; `false` leaves `console.error` and the window's error events alone.
   */
  errors?: boolean
}

export function resolveClientOptions(options: ObserveClientOptions = {}) {
  // process.env.OBSERVE_SERVICE_NAME is inlined at build time by withObserve() via next.config `env`.
  const serviceName = options.serviceName ?? process.env.OBSERVE_SERVICE_NAME ?? DEFAULT_SERVICE_NAME
  const serviceVersion = options.serviceVersion ?? process.env.OBSERVE_SERVICE_VERSION
  return {
    serviceName: `${serviceName}-browser`,
    ...(serviceVersion ? { serviceVersion } : {}),
    exportUrl: options.exportUrl ?? `${BROWSER_PROXY_PATH}/v1/traces`,
  }
}

/**
 * Sends what is batched when the page goes away (navigation, closing, switching tabs). Without it the last ~2 s of
 * spans are lost — a click to the next page dropped the fetch spans of the current one (seen in the workshop rehearsal).
 * The OTLP exporter sends with fetch keepalive, which survives the page unloading.
 */
export function flushWhenHidden(
  provider: { forceFlush(): Promise<void> },
  win: Pick<EventTarget, 'addEventListener'>,
  doc: Pick<EventTarget, 'addEventListener'> & { visibilityState: string },
): void {
  const flush = () => void provider.forceFlush().catch(() => {})
  win.addEventListener('pagehide', flush)
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flush()
  })
}

const NEXT_DEV_REQUESTS = /\/__nextjs_/

export function registerClient(options?: ObserveClientOptions): WebTracerProvider {
  const { serviceName, serviceVersion, exportUrl } = resolveClientOptions(options)
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}) }),
    // Batched export, flushed when the page is hidden (flushWhenHidden below).
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: exportUrl }), { scheduledDelayMillis: 2000 })],
  })
  provider.register()
  flushWhenHidden(provider, window, document)
  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      // No ignoreUrls for our own exports: the OTLP exporter already suppresses tracing of its requests (checked e2e).
      // `/__nextjs_…` is next dev's own traffic (its error overlay asks for source frames) — not the app's.
      new FetchInstrumentation({ ignoreUrls: [NEXT_DEV_REQUESTS], applyCustomAttributesOnSpan: markFailedFetch }),
      // axios and older code talk to the API through XMLHttpRequest, not fetch.
      new XMLHttpRequestInstrumentation({ ignoreUrls: [NEXT_DEV_REQUESTS], applyCustomAttributesOnSpan: markFailedXhr }),
    ],
  })
  if (options?.errors !== false) {
    captureBrowserErrors({ tracer: provider.getTracer('next-observe'), win: window, console, response: Response.prototype })
  }
  return provider
}

if (typeof window !== 'undefined') registerClient()
