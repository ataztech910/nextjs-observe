// What goes wrong in the browser and never reaches a traced request: an exception in a click handler, a promise
// nobody awaited, something written to console.error (React reports errors caught by an error boundary there), an
// image or a script that failed to load. Each becomes one failed span, so the observer lists it as a defect.
import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api'

export type BrowserErrorKind = 'uncaught error' | 'unhandled rejection' | 'console.error' | 'resource error' | 'invalid JSON response'

export interface BrowserErrorTargets {
  tracer: Tracer
  /** `window`: 'error' (uncaught exceptions; in the capture phase also failed resources) and 'unhandledrejection'. */
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  /** `console`: its `error` is wrapped; the original is always called. */
  console: { error: (...args: unknown[]) => void }
  /**
   * `Response.prototype`: its `json()` is wrapped. `fetch(url).then((res) => res.json())` on an HTML error page is one
   * of the most common browser bugs, and Chromium fires no 'unhandledrejection' for it (checked with a real click, with
   * and without instrumentation) — so it is recorded here, as its own kind: the app asked for JSON and the body was not
   * JSON, whether or not the app went on to handle that.
   */
  response?: { json: (...args: unknown[]) => Promise<unknown> }
  /** The page the error happened on. Default: `location.pathname`. */
  page?: () => string | undefined
  /**
   * At most this many error spans per page load. A broken render loop can throw thousands of times a second; the
   * first ones say everything. Default 50.
   */
  limit?: number
  /** The same error (kind and message) again within this time is not recorded twice. Default 1000 ms. */
  dedupeMs?: number
  now?: () => number
}

const MAX_MESSAGE = 2000
const MAX_STACK = 4000

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

function describe(value: unknown): { type?: string; message: string; stack?: string } {
  if (value instanceof Error) return { type: value.name, message: value.message, ...(value.stack ? { stack: value.stack } : {}) }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  } catch {
    // Circular structures and the like.
    return { message: String(value) }
  }
}

/** console.error('Failed to save %s', id, error) → the text as the console would show it, and the first Error for its stack. */
function describeConsoleArgs(args: unknown[]): { type?: string; message: string; stack?: string } {
  const error = args.find((a): a is Error => a instanceof Error)
  return { ...(error ? { type: error.name, ...(error.stack ? { stack: error.stack } : {}) } : {}), message: formatConsole(args) }
}

/**
 * console.error('%o\n\n%s', error, text) — React reports an error caught by a boundary this way — printed the way the
 * console prints it: %s %o %O %d %i %f take the next argument, %c (styling) swallows its argument, %% is a percent
 * sign; whatever is left over is appended.
 */
export function formatConsole(args: unknown[]): string {
  const [first, ...rest] = args
  if (typeof first !== 'string') return args.map((a) => describe(a).message).join(' ')
  let next = 0
  const text = first.replace(/%([sdifoOc%])/g, (specifier, kind: string) => {
    if (kind === '%') return '%'
    if (next >= rest.length) return specifier
    const value = rest[next++]
    return kind === 'c' ? '' : describe(value).message
  })
  return [text, ...rest.slice(next).map((a) => describe(a).message)].join(' ').trim()
}

/**
 * Starts recording browser errors as spans. Returns a function that undoes it (listeners removed, console.error
 * restored — unless something else wrapped it in the meantime, then ours stays in the chain but records nothing).
 */
export function captureBrowserErrors(targets: BrowserErrorTargets): () => void {
  const { tracer, win } = targets
  const limit = targets.limit ?? 50
  const dedupeMs = targets.dedupeMs ?? 1000
  const now = targets.now ?? Date.now
  const page = targets.page ?? (() => (typeof location === 'undefined' ? undefined : location.pathname))
  let recorded = 0
  let active = true
  // Recording a span must never record another one: an exporter or a console wrapper further down the chain that
  // logs with console.error would loop.
  let recording = false
  const lastSeen = new Map<string, number>()

  function record(kind: BrowserErrorKind, what: { type?: string; message: string; stack?: string }, attributes: Record<string, string | number> = {}) {
    if (!active || recording) return
    const message = clip(what.message || '(no message)', MAX_MESSAGE)
    const key = `${kind}\u0000${message}`
    const at = now()
    const seenAt = lastSeen.get(key)
    if (seenAt !== undefined && at - seenAt < dedupeMs) return
    if (recorded >= limit) return
    // Remembered only when recorded: an error that keeps repeating is recorded once per window, not once ever.
    lastSeen.set(key, at)
    recorded++
    recording = true
    try {
      const path = page()
      const span = tracer.startSpan(kind, { attributes: { 'observe.kind': 'browser-error', ...(path ? { 'url.path': path } : {}), ...attributes } })
      span.addEvent('exception', {
        'exception.message': message,
        ...(what.type ? { 'exception.type': what.type } : {}),
        ...(what.stack ? { 'exception.stacktrace': clip(what.stack, MAX_STACK) } : {}),
      })
      span.setStatus({ code: SpanStatusCode.ERROR, message })
      span.end()
    } catch {
      // Telemetry must not break the page it watches.
    } finally {
      recording = false
    }
  }

  const onError = (event: Event) => {
    const e = event as ErrorEvent
    const target = event.target as { tagName?: string; src?: string; href?: string } | null
    // A failed <img>/<script>/<link> dispatches 'error' on the element; it does not bubble, so it is seen only in the
    // capture phase, and it carries no error or message — the element is all there is.
    if (target && target !== (win as unknown) && typeof target.tagName === 'string') {
      const url = target.src || target.href
      if (!url) return
      const tag = target.tagName.toLowerCase()
      record('resource error', { message: `Failed to load <${tag}> ${url}` }, { 'resource.tag': tag, 'url.full': url })
      return
    }
    const where = { ...(e.filename ? { 'code.filepath': e.filename } : {}), ...(e.lineno ? { 'code.lineno': e.lineno } : {}), ...(e.colno ? { 'code.column': e.colno } : {}) }
    record('uncaught error', e.error !== undefined && e.error !== null ? describe(e.error) : { message: e.message }, where)
  }
  const onRejection = (event: Event) => record('unhandled rejection', describe((event as PromiseRejectionEvent).reason))

  win.addEventListener('error', onError, true)
  win.addEventListener('unhandledrejection', onRejection)

  const original = targets.console.error
  const wrapped = function (this: unknown, ...args: unknown[]) {
    record('console.error', describeConsoleArgs(args))
    return original.apply(this, args)
  }
  targets.console.error = wrapped

  const response = targets.response
  const originalJson = response?.json
  const wrappedJson = function (this: { url?: string; status?: number; headers?: { get(name: string): string | null } }, ...args: unknown[]) {
    // A derived promise that rejects with the same reason: the caller's handling (or lack of it) works as before —
    // attaching a handler to the original promise instead would silently mark it as handled.
    return originalJson!.apply(this, args).then(
      (value) => value,
      (reason: unknown) => {
        const type = this.headers?.get('content-type')
        const from = [this.status, type].filter((part) => part !== undefined && part !== null && part !== '').join(', ')
        const what = describe(reason)
        record('invalid JSON response', { ...what, message: `Response${from ? ` (${from})` : ''} is not JSON: ${what.message}` }, {
          ...(this.url ? { 'url.full': this.url } : {}),
          ...(typeof this.status === 'number' ? { 'http.response.status_code': this.status } : {}),
        })
        throw reason
      },
    )
  }
  if (response && originalJson) response.json = wrappedJson

  return () => {
    active = false
    win.removeEventListener('error', onError, true)
    win.removeEventListener('unhandledrejection', onRejection)
    if (targets.console.error === wrapped) targets.console.error = original
    if (response && originalJson && response.json === wrappedJson) response.json = originalJson
  }
}

const aborted = (message: string) => /abort/i.test(message)

/**
 * For the fetch instrumentation's `applyCustomAttributesOnSpan`: a request that got no response at all (DNS, refused
 * connection, CORS, offline) ends its span without an error status — it has no HTTP status to judge by. Marked failed
 * here. A request the app cancelled itself (AbortController, leaving the page) is not a failure.
 */
export function markFailedFetch(span: Pick<Span, 'setStatus'>, _request: unknown, result: unknown): void {
  // A Response has `ok`; what the instrumentation passes for a failed request is { message, status? }.
  if (!result || typeof result !== 'object' || 'ok' in result) return
  const message = typeof (result as { message?: unknown }).message === 'string' ? (result as { message: string }).message : ''
  if (aborted(message)) return
  span.setStatus({ code: SpanStatusCode.ERROR, message: `Network request failed${message ? `: ${message}` : ''}` })
}

/** The same for XMLHttpRequest: finished (readyState 4) with status 0 = no response. An aborted one is back at readyState 0. */
export function markFailedXhr(span: Pick<Span, 'setStatus'>, xhr: { readyState: number; status: number }): void {
  if (xhr.readyState === 4 && xhr.status === 0) span.setStatus({ code: SpanStatusCode.ERROR, message: 'Network request failed' })
}
