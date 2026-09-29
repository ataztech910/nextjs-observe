// Browser instrumentation: `import 'next-observe/client'` in instrumentation-client.ts.
// Next runs that file before hydration, so the provider exists before any component renders.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { BROWSER_PROXY_PATH, DEFAULT_SERVICE_NAME } from './constants.js'

export interface ObserveClientOptions {
  serviceName?: string
  /** Where spans are POSTed. Default: same-origin proxy that withObserve() rewrites to the collector. */
  exportUrl?: string
}

export function resolveClientOptions(options: ObserveClientOptions = {}) {
  // process.env.OBSERVE_SERVICE_NAME is inlined at build time by withObserve() via next.config `env`.
  const serviceName = options.serviceName ?? process.env.OBSERVE_SERVICE_NAME ?? DEFAULT_SERVICE_NAME
  return {
    serviceName: `${serviceName}-browser`,
    exportUrl: options.exportUrl ?? `${BROWSER_PROXY_PATH}/v1/traces`,
  }
}

export function registerClient(options?: ObserveClientOptions): WebTracerProvider {
  const { serviceName, exportUrl } = resolveClientOptions(options)
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    // Batched export; the browser BatchSpanProcessor also flushes when the page is hidden.
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: exportUrl }), { scheduledDelayMillis: 2000 })],
  })
  provider.register()
  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      // No ignoreUrls for our own exports: the OTLP exporter already suppresses tracing of its requests (checked e2e).
      new FetchInstrumentation(),
    ],
  })
  return provider
}

if (typeof window !== 'undefined') registerClient()
