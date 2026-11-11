// Explicit manual work timing. No Next.js/DOM imports, SDK bootstrap or React internals.
import { ROOT_CONTEXT, SpanStatusCode, metrics, trace, type Attributes, type Context, type Meter, type Span, type Tracer } from '@opentelemetry/api'

export type PerformanceMode = 'disabled' | 'diagnostic' | 'production_like'
export type WorkPhase = 'compute' | 'reducer' | 'effect.setup' | 'effect.cleanup'
export interface PerformanceProbeOptions {
  mode: PerformanceMode
  /** Static, low-cardinality source identity. Build/run/variant usually belong on the SDK resource. */
  source: { file: string; site: string }
  tracer?: Tracer
  meter?: Meter
  /** Monotonic milliseconds. Default performance.now(), available in browser/Node; validate RN separately. */
  now?: () => number
}
export interface PerformanceInteraction {
  /** Pass explicitly across callbacks/awaits. This helper does not install an async context manager. */
  readonly context: Context
  /** Measures only synchronous execution; returned promises/cleanup functions keep their identity. */
  measureSync<T>(name: string, phase: WorkPhase, work: (context: Context) => T): T
  event(name: string, attributes?: Attributes): void
  /** Action start → caller-declared endpoint. Idempotent; late work runs without attribution. */
  end(outcome: 'committed' | 'cancelled' | 'error'): void
}
export function createPerformanceProbe(options: PerformanceProbeOptions) {
  const enabled = options.mode !== 'disabled'
  // Disabled mode must not even ask a provider for instruments or timestamps.
  const tracer = enabled ? options.tracer ?? trace.getTracer('next-observe/performance', '1') : undefined
  const meter = enabled ? options.meter ?? metrics.getMeter('next-observe/performance', '1') : undefined
  const workDuration = meter?.createHistogram('observe.perf.work.duration', { unit: 's', description: 'Selected synchronous callback-body elapsed time; includes instrumentation clock calls.' })
  const interactionDuration = meter?.createHistogram('observe.perf.interaction.duration', { unit: 's', description: 'Action handler start to the caller-declared completion endpoint; not paint or INP.' })
  const now = options.now ?? (() => performance.now())
  const source = { 'code.filepath': options.source.file, 'observe.perf.site': options.source.site, 'observe.perf.mode': options.mode }
  function startInteraction(name: string, parentContext: Context = ROOT_CONTEXT): PerformanceInteraction {
    let ended = false
    const started = enabled ? now() : 0
    const span = tracer?.startSpan(name, { attributes: { ...source, 'observe.perf.phase': 'interaction', 'observe.perf.endpoint': 'caller-declared' } }, parentContext)
    const interactionContext = span ? trace.setSpan(parentContext, span) : parentContext
    return {
      context: interactionContext,
      measureSync<T>(workName: string, phase: WorkPhase, work: (context: Context) => T): T {
        if (!enabled || ended) return work(interactionContext)
        const attributes = { ...source, 'observe.perf.phase': phase, 'code.function': workName }
        const workSpan = options.mode === 'diagnostic' ? tracer!.startSpan(workName, { attributes }, interactionContext) : undefined
        const workContext = workSpan ? trace.setSpan(interactionContext, workSpan) : interactionContext
        const start = now()
        let outcome = 'ok'
        try { return work(workContext) }
        catch (error) {
          outcome = 'error'
          recordError(workSpan, error)
          throw error
        } finally {
          const elapsed = now() - start
          // Do not invent durations if a custom clock is unavailable/non-monotonic.
          if (Number.isFinite(elapsed) && elapsed >= 0) workDuration!.record(elapsed / 1000, { ...attributes, outcome }, workContext)
          workSpan?.end()
        }
      },
      event(eventName, attributes) { if (!ended) span?.addEvent(eventName, attributes) },
      end(outcome) {
        if (ended) return
        ended = true
        if (!enabled) return
        const elapsed = now() - started
        if (Number.isFinite(elapsed) && elapsed >= 0) interactionDuration!.record(elapsed / 1000, { ...source, outcome }, interactionContext)
        span!.setAttribute('observe.perf.outcome', outcome)
        if (outcome === 'error') span!.setStatus({ code: SpanStatusCode.ERROR })
        span!.end()
      },
    }
  }
  return { startInteraction }
}
function recordError(span: Span | undefined, error: unknown) {
  if (!span) return
  span.recordException(error instanceof Error ? error : String(error))
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
}
