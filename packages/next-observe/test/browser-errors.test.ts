import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'
import { captureBrowserErrors, formatConsole, markFailedFetch, markFailedXhr, type BrowserErrorTargets } from '../src/browser-errors.js'

interface Recorded {
  name: string
  attributes: Record<string, unknown>
  events: { name: string; attributes: Record<string, unknown> }[]
  status?: { code: number; message?: string }
  ended: boolean
}

function setup(extra: Partial<BrowserErrorTargets> = {}) {
  const spans: Recorded[] = []
  const tracer = {
    startSpan(name: string, options: { attributes?: Record<string, unknown> } = {}) {
      const span: Recorded = { name, attributes: { ...options.attributes }, events: [], ended: false }
      spans.push(span)
      return {
        addEvent: (eventName: string, attributes: Record<string, unknown>) => void span.events.push({ name: eventName, attributes }),
        setStatus: (status: Recorded['status']) => void (span.status = status),
        end: () => void (span.ended = true),
      }
    },
  } as unknown as Tracer
  const win = new EventTarget()
  const printed: unknown[][] = []
  const fakeConsole = { error: (...args: unknown[]) => void printed.push(args) }
  let clock = 1_000_000
  const stop = captureBrowserErrors({ tracer, win, console: fakeConsole, page: () => '/product/3', now: () => clock, ...extra })
  const fire = (type: string, props: Record<string, unknown> = {}) => win.dispatchEvent(Object.assign(new Event(type), props))
  return { spans, win, fakeConsole, printed, stop, fire, tick: (ms: number) => void (clock += ms) }
}

const exception = (span: Recorded) => span.events.find((e) => e.name === 'exception')!.attributes

describe('captureBrowserErrors', () => {
  it('an uncaught exception: a failed span with type, message, stack, the page and where it was thrown', () => {
    const h = setup()
    const error = new TypeError("Cannot read properties of undefined (reading 'price')")
    h.fire('error', { error, message: `Uncaught ${error}`, filename: 'http://localhost:3000/_next/static/chunks/buy.js', lineno: 21, colno: 14 })
    expect(h.spans).toHaveLength(1)
    const [span] = h.spans
    expect(span).toMatchObject({ name: 'uncaught error', ended: true, status: { code: SpanStatusCode.ERROR, message: "Cannot read properties of undefined (reading 'price')" } })
    expect(span.attributes).toEqual({ 'observe.kind': 'browser-error', 'url.path': '/product/3', 'code.filepath': 'http://localhost:3000/_next/static/chunks/buy.js', 'code.lineno': 21, 'code.column': 14 })
    expect(exception(span)).toEqual({ 'exception.type': 'TypeError', 'exception.message': "Cannot read properties of undefined (reading 'price')", 'exception.stacktrace': error.stack })
  })

  it('an error event without an Error object (a cross-origin "Script error.") keeps its message', () => {
    const h = setup()
    h.fire('error', { error: null, message: 'Script error.' })
    expect(h.spans[0]).toMatchObject({ name: 'uncaught error', status: { message: 'Script error.' } })
    expect(exception(h.spans[0])).toEqual({ 'exception.message': 'Script error.' })
  })

  it('an unhandled promise rejection — with an Error, a string or an object as the reason', () => {
    const h = setup()
    h.fire('unhandledrejection', { reason: new SyntaxError('Unexpected token < in JSON at position 0') })
    h.fire('unhandledrejection', { reason: 'timeout' })
    h.fire('unhandledrejection', { reason: { code: 42 } })
    expect(h.spans.map((s) => [s.name, s.status!.message])).toEqual([
      ['unhandled rejection', 'Unexpected token < in JSON at position 0'],
      ['unhandled rejection', 'timeout'],
      ['unhandled rejection', '{"code":42}'],
    ])
    expect(exception(h.spans[0])['exception.type']).toBe('SyntaxError')
  })

  it('console.error: recorded with the text as printed and the stack of the Error among the arguments — and still printed', () => {
    const h = setup()
    const error = new Error('boom')
    h.fakeConsole.error('Failed to save order', 17, error)
    expect(h.printed).toEqual([['Failed to save order', 17, error]])
    expect(h.spans[0]).toMatchObject({ name: 'console.error', status: { message: 'Failed to save order 17 boom' } })
    expect(exception(h.spans[0])).toMatchObject({ 'exception.type': 'Error', 'exception.stacktrace': error.stack })
    // No Error among the arguments: just the message.
    h.fakeConsole.error('Warning: something')
    expect(exception(h.spans[1])).toEqual({ 'exception.message': 'Warning: something' })
    // React's report of an error caught by a boundary: a format string, the error, the component note.
    const renderError = new TypeError('product is undefined')
    h.fakeConsole.error('%o\n\n%s', renderError, 'The above error occurred in the <Price> component.')
    expect(h.spans[2].status!.message).toBe('product is undefined\n\nThe above error occurred in the <Price> component.')
    expect(exception(h.spans[2])['exception.type']).toBe('TypeError')
  })

  it('a resource that failed to load: seen in the capture phase on the element, named by its tag and URL', () => {
    const h = setup()
    // The event is dispatched on the element and does not bubble; a capturing listener on window still sees it.
    const seen: Event[] = []
    h.win.addEventListener('error', (e) => seen.push(e), true)
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: { tagName: 'IMG', src: 'http://localhost:3000/products/3.png' } })
    h.win.dispatchEvent(event)
    expect(seen).toHaveLength(1)
    expect(h.spans[0]).toMatchObject({ name: 'resource error', status: { message: 'Failed to load <img> http://localhost:3000/products/3.png' } })
    expect(h.spans[0].attributes).toMatchObject({ 'resource.tag': 'img', 'url.full': 'http://localhost:3000/products/3.png' })
    // <link href>, and an element without a URL says nothing useful.
    const link = new Event('error')
    Object.defineProperty(link, 'target', { value: { tagName: 'LINK', href: 'http://localhost:3000/a.css' } })
    h.win.dispatchEvent(link)
    const empty = new Event('error')
    Object.defineProperty(empty, 'target', { value: { tagName: 'IMG' } })
    h.win.dispatchEvent(empty)
    expect(h.spans.map((s) => s.status!.message)).toEqual(['Failed to load <img> http://localhost:3000/products/3.png', 'Failed to load <link> http://localhost:3000/a.css'])
  })

  it('the same error again within a second is not recorded twice; after that it is — once per window, not once ever', () => {
    const h = setup()
    const fail = () => h.fire('error', { error: new Error('render loop') })
    fail()
    h.tick(400)
    fail()
    h.tick(400)
    fail()
    expect(h.spans).toHaveLength(1)
    h.tick(300) // 1100 ms after the recorded one
    fail()
    expect(h.spans).toHaveLength(2)
    // A different message, or the same message from another source, is its own error.
    h.fire('error', { error: new Error('something else') })
    h.fakeConsole.error('render loop')
    expect(h.spans).toHaveLength(4)
  })

  it('stops at the limit per page load', () => {
    const h = setup({ limit: 3 })
    for (let i = 0; i < 10; i++) h.fire('error', { error: new Error(`error ${i}`) })
    expect(h.spans.map((s) => s.status!.message)).toEqual(['error 0', 'error 1', 'error 2'])
    // console.error keeps printing whatever the limit.
    h.fakeConsole.error('still printed')
    expect(h.printed).toEqual([['still printed']])
  })

  it('very long messages and stacks are cut', () => {
    const h = setup()
    const error = new Error('x'.repeat(5000))
    error.stack = 's'.repeat(9000)
    h.fire('error', { error })
    expect((exception(h.spans[0])['exception.message'] as string).length).toBe(2001)
    expect((exception(h.spans[0])['exception.stacktrace'] as string).length).toBe(4001)
  })

  it('a console.error raised while recording a span is printed but not recorded: no loop', () => {
    const spans: string[] = []
    const fakeConsole = { error: (..._args: unknown[]) => {} }
    const tracer = {
      startSpan(name: string) {
        spans.push(name)
        // An exporter or another wrapper complaining through the console.
        fakeConsole.error('exporter failed')
        return { addEvent() {}, setStatus() {}, end() {} }
      },
    } as unknown as Tracer
    captureBrowserErrors({ tracer, win: new EventTarget(), console: fakeConsole })
    fakeConsole.error('first')
    expect(spans).toEqual(['console.error'])
  })

  it('a tracer that throws does not break console.error or the page', () => {
    const printed: unknown[][] = []
    const fakeConsole = { error: (...args: unknown[]) => void printed.push(args) }
    const tracer = { startSpan: () => { throw new Error('tracer is broken') } } as unknown as Tracer
    const win = new EventTarget()
    captureBrowserErrors({ tracer, win, console: fakeConsole })
    expect(() => fakeConsole.error('hello')).not.toThrow()
    expect(() => win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('x') }))).not.toThrow()
    expect(printed).toEqual([['hello']])
  })

  it('circular objects in console.error do not throw', () => {
    const h = setup()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => h.fakeConsole.error('state', circular)).not.toThrow()
    expect(h.spans[0].status!.message).toBe('state [object Object]')
  })

  it('stop(): listeners removed and console.error restored', () => {
    const h = setup()
    const wrapped = h.fakeConsole.error
    h.stop()
    expect(h.fakeConsole.error).not.toBe(wrapped)
    h.fakeConsole.error('after')
    h.fire('error', { error: new Error('after') })
    h.fire('unhandledrejection', { reason: 'after' })
    expect(h.spans).toEqual([])
    expect(h.printed).toEqual([['after']])
  })

  it('stop() removes exactly the listeners it added (the capturing one included)', () => {
    const added: [string, unknown, unknown][] = []
    const removed: [string, unknown, unknown][] = []
    const win = {
      addEventListener: (type: string, fn: unknown, capture?: unknown) => void added.push([type, fn, capture]),
      removeEventListener: (type: string, fn: unknown, capture?: unknown) => void removed.push([type, fn, capture]),
    } as unknown as EventTarget
    const stop = captureBrowserErrors({ tracer: {} as Tracer, win, console: { error() {} } })
    expect(added.map(([type, , capture]) => [type, capture])).toEqual([['error', true], ['unhandledrejection', undefined]])
    stop()
    expect(removed).toEqual(added)
  })

  it('stop() when something else wrapped console.error meanwhile: their wrapper stays, ours records nothing', () => {
    const h = setup()
    const ours = h.fakeConsole.error
    const theirs = (...args: unknown[]) => ours('[theirs]', ...args)
    h.fakeConsole.error = theirs
    h.stop()
    expect(h.fakeConsole.error).toBe(theirs)
    h.fakeConsole.error('x')
    expect(h.spans).toEqual([])
    expect(h.printed).toEqual([['[theirs]', 'x']])
  })

  it('no page available (not in a browser): no url.path attribute', () => {
    const h = setup({ page: () => undefined })
    h.fire('error', { error: new Error('x') })
    expect(h.spans[0].attributes).toEqual({ 'observe.kind': 'browser-error' })
  })

  describe('Response.json()', () => {
    /** A stand-in for Response.prototype with instances made from it, like the real thing. */
    function fakeResponse() {
      const proto = {
        json(this: { body: string }) {
          return Promise.resolve().then(() => JSON.parse(this.body) as unknown)
        },
      }
      const make = (body: string, extra: Record<string, unknown> = {}) => Object.assign(Object.create(proto) as typeof proto & { body: string }, { body, ...extra })
      return { proto, make }
    }

    it('a body that is not JSON: recorded with the status, the content type and the URL — and the caller still gets the rejection', async () => {
      const { proto, make } = fakeResponse()
      const h = setup({ response: proto })
      const res = make('<html>Bad gateway</html>', { url: 'http://localhost:3000/api/checkout', status: 502, headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) } })
      const reason = await res.json().catch((e: unknown) => e)
      expect(reason).toBeInstanceOf(SyntaxError)
      expect(h.spans).toHaveLength(1)
      expect(h.spans[0].name).toBe('invalid JSON response')
      expect(h.spans[0].status!.message).toMatch(/^Response \(502, text\/html\) is not JSON: Unexpected token/)
      expect(h.spans[0].attributes).toMatchObject({ 'url.full': 'http://localhost:3000/api/checkout', 'http.response.status_code': 502, 'url.path': '/product/3' })
      expect(exception(h.spans[0])['exception.type']).toBe('SyntaxError')
    })

    it('valid JSON passes through untouched and records nothing', async () => {
      const { proto, make } = fakeResponse()
      const h = setup({ response: proto })
      expect(await make('{"inStock":3}').json()).toEqual({ inStock: 3 })
      expect(h.spans).toEqual([])
    })

    it('the rejection stays the caller’s to handle: an unhandled one is still unhandled', async () => {
      const { proto, make } = fakeResponse()
      setup({ response: proto })
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => void unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      try {
        void make('<html>').json()
        await new Promise((r) => setTimeout(r, 20))
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
      expect(unhandled).toHaveLength(1)
      expect(unhandled[0]).toBeInstanceOf(SyntaxError)
    })

    it('a response without status, headers or URL still gets a readable message', async () => {
      const { proto, make } = fakeResponse()
      const h = setup({ response: proto })
      await make('nope').json().catch(() => {})
      expect(h.spans[0].status!.message).toMatch(/^Response is not JSON: /)
      expect(h.spans[0].attributes).toEqual({ 'observe.kind': 'browser-error', 'url.path': '/product/3' })
    })

    it('stop() restores json()', async () => {
      const { proto, make } = fakeResponse()
      const original = proto.json
      const h = setup({ response: proto })
      expect(proto.json).not.toBe(original)
      h.stop()
      expect(proto.json).toBe(original)
      await make('nope').json().catch(() => {})
      expect(h.spans).toEqual([])
    })
  })
})

describe('markFailedFetch', () => {
  const statusOf = (result: unknown) => {
    let status: { code: number; message?: string } | undefined
    markFailedFetch({ setStatus: (s) => ((status = s), undefined as never) }, {}, result)
    return status
  }

  it('no response at all (refused, DNS, CORS, offline) → the span is an error with the browser’s reason', () => {
    expect(statusOf({ message: 'Failed to fetch' })).toEqual({ code: SpanStatusCode.ERROR, message: 'Network request failed: Failed to fetch' })
    expect(statusOf({ message: '' })).toEqual({ code: SpanStatusCode.ERROR, message: 'Network request failed' })
  })

  it('a response — whatever its status — is left to the instrumentation; an aborted request is not a failure', () => {
    expect(statusOf(new Response('x', { status: 500 }))).toBeUndefined()
    expect(statusOf(new Response('ok'))).toBeUndefined()
    expect(statusOf({ message: 'The user aborted a request.' })).toBeUndefined()
    expect(statusOf({ message: 'signal is aborted without reason' })).toBeUndefined()
    expect(statusOf(undefined)).toBeUndefined()
  })
})

describe('markFailedXhr', () => {
  const statusOf = (xhr: { readyState: number; status: number }) => {
    let status: { code: number; message?: string } | undefined
    markFailedXhr({ setStatus: (s) => ((status = s), undefined as never) }, xhr)
    return status
  }

  it('finished with status 0 → failed; a response or an aborted request → untouched', () => {
    expect(statusOf({ readyState: 4, status: 0 })).toEqual({ code: SpanStatusCode.ERROR, message: 'Network request failed' })
    expect(statusOf({ readyState: 4, status: 500 })).toBeUndefined()
    expect(statusOf({ readyState: 4, status: 200 })).toBeUndefined()
    expect(statusOf({ readyState: 0, status: 0 })).toBeUndefined()
  })
})

describe('formatConsole', () => {
  it('substitutes format specifiers like the console does — the way React reports an error caught by a boundary', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'price')")
    expect(formatConsole(['%o\n\n%s', error, 'The above error occurred in the <Price> component.'])).toBe(
      "Cannot read properties of undefined (reading 'price')\n\nThe above error occurred in the <Price> component.",
    )
  })

  it('%c swallows its styling argument, %% is a percent sign, numbers and objects are substituted', () => {
    expect(formatConsole(['%cWarning%c: %d of %i items failed (%f%%) %O', 'color: red', '', 3, 10, 30.5, { id: 7 }])).toBe('Warning: 3 of 10 items failed (30.5%) {"id":7}')
  })

  it('extra arguments are appended, missing ones leave the specifier, a non-string first argument means no format', () => {
    expect(formatConsole(['Failed to save %s', 'order', 17, new Error('quota')])).toBe('Failed to save order 17 quota')
    expect(formatConsole(['%s and %s', 'one'])).toBe('one and %s')
    expect(formatConsole([new Error('boom'), '%s', 'x'])).toBe('boom %s x')
    expect(formatConsole([])).toBe('')
  })
})
