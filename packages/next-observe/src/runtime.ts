// Runtime for code transformed from the observe directive. Works on server (Node/Edge) and in the browser.
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'

type Kind = 'component' | 'function'

const tracer = trace.getTracer('next-observe')
const isBrowser = typeof window !== 'undefined'

// Browser component renders are aggregated — a span per render would flood the collector.
type RenderStats = { count: number; totalMs: number; maxMs: number }
const renders = new Map<string, RenderStats>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function recordRender(name: string, ms: number) {
  const stats = renders.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
  stats.count++
  stats.totalMs += ms
  stats.maxMs = Math.max(stats.maxMs, ms)
  renders.set(name, stats)
  flushTimer ??= setTimeout(flushRenders, 5000)
}

function flushRenders() {
  flushTimer = undefined
  if (renders.size === 0) return
  const span = tracer.startSpan('react.renders')
  for (const [name, s] of renders) {
    span.setAttribute(`react.render.${name}.count`, s.count)
    span.setAttribute(`react.render.${name}.total_ms`, Number(s.totalMs.toFixed(3)))
    span.setAttribute(`react.render.${name}.max_ms`, Number(s.maxMs.toFixed(3)))
  }
  console.log('[observe] client renders', Object.fromEntries(renders))
  renders.clear()
  span.end()
}

function fail(span: Span, error: unknown) {
  span.recordException(error as Error)
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
  span.end()
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
}

function run<T>(name: string, kind: Kind, file: string, fn: () => T): T {
  if (isBrowser && kind === 'component') {
    const start = performance.now()
    try {
      return fn()
    } finally {
      recordRender(name, performance.now() - start)
    }
  }

  const spanName = kind === 'component' ? `render ${name}` : name
  const attributes = { 'code.function': name, 'code.filepath': file, 'observe.kind': kind }
  return tracer.startActiveSpan(spanName, { attributes }, (span) => {
    try {
      const result = fn()
      if (!isThenable(result)) {
        span.end()
        return result
      }
      return Promise.resolve(result).then(
        (value) => {
          span.end()
          return value
        },
        (error) => {
          fail(span, error)
          throw error
        },
      ) as T
    } catch (error) {
      fail(span, error)
      throw error
    }
  })
}

export const __observe = { run }
