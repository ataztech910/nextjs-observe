import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CHECK_HEADER, CheckRunner, MAX_BODY_BYTES, type CheckResult } from '../src/checks/runner.js'
import { validateCheck, validateChecks } from '../src/checks/spec.js'

describe('observe.checks: validation', () => {
  it('fills in the defaults', () => {
    expect(validateCheck({ name: 'catalog', url: '/api/products' })).toEqual({ name: 'catalog', url: '/api/products', method: 'GET', headers: {}, everyMs: 60_000, timeoutMs: 10_000, expect: {} })
  })

  it('normalises method, headers, status and a JSON body', () => {
    const check = validateCheck({ name: 'junk order', url: 'https://shop.example/api/checkout', method: 'post', headers: { 'X-Team': 'web' }, body: { quantity: 99 }, everySeconds: 5, timeoutMs: 500, expect: { status: 400, maxMs: 300, bodyIncludes: 'quantity' } })
    expect(check).toEqual({
      name: 'junk order',
      url: 'https://shop.example/api/checkout',
      method: 'POST',
      headers: { 'x-team': 'web', 'content-type': 'application/json' },
      body: '{"quantity":99}',
      everyMs: 5000,
      timeoutMs: 500,
      expect: { status: [400], maxMs: 300, bodyIncludes: 'quantity' },
    })
  })

  it('sends a string body as is and keeps the content type the check set', () => {
    expect(validateCheck({ name: 'a', url: '/a', method: 'PUT', body: 'x=1' })).toMatchObject({ body: 'x=1', headers: {} })
    expect(validateCheck({ name: 'a', url: '/a', method: 'PUT', headers: { 'Content-Type': 'application/vnd.api+json' }, body: {} }).headers).toEqual({ 'content-type': 'application/vnd.api+json' })
  })

  it('a body text may be expected when at least one good status has a body', () => {
    expect(validateCheck({ name: 'a', url: '/a', expect: { status: [200, 204], bodyIncludes: 'x' } }).expect).toEqual({ status: [200, 204], bodyIncludes: 'x' })
  })

  it('accepts several good statuses', () => {
    expect(validateCheck({ name: 'a', url: '/a', expect: { status: [301, 302] } }).expect).toEqual({ status: [301, 302] })
  })

  it.each([
    [null, 'a check must be an object'],
    [{ url: '/a' }, 'a check needs a `name`'],
    [{ name: ' ', url: '/a' }, 'a check needs a `name`'],
    [{ name: 'a' }, 'check "a": `url` must be a path starting with "/" or a full http(s) URL'],
    [{ name: 'a', url: 'api/products' }, 'check "a": `url` must be a path'],
    [{ name: 'a', url: 'ftp://x/y' }, 'check "a": `url` must be a path'],
    [{ name: 'a', url: 'http://' }, 'check "a": `url` is not a valid URL'],
    [{ name: 'a', url: '/a', method: 'FETCH' }, 'check "a": `method` must be one of GET'],
    [{ name: 'a', url: '/a', method: 7 }, 'check "a": `method` must be one of GET'],
    [{ name: 'a', url: '/a', headers: { a: 1 } }, 'check "a": header `a` must be a string'],
    [{ name: 'a', url: '/a', headers: [] }, 'check "a": `headers` must be an object'],
    [{ name: 'a', url: '/a', body: {} }, 'check "a": a GET request cannot have a `body`'],
    [{ name: 'a', url: '/a', everySeconds: 4 }, 'check "a": `everySeconds` must be a number from 5 to 86400'],
    [{ name: 'a', url: '/a', everySeconds: '60' }, 'check "a": `everySeconds`'],
    [{ name: 'a', url: '/a', timeoutMs: 99 }, 'check "a": `timeoutMs` must be a number from 100 to 120000'],
    [{ name: 'a', url: '/a', timeoutMs: 120_001 }, 'check "a": `timeoutMs`'],
    [{ name: 'a', url: '/a', expects: {} }, 'check "a": unknown field `expects`'],
    [{ name: 'a', url: '/a', expect: 200 }, 'check "a": `expect` must be an object'],
    [{ name: 'a', url: '/a', expect: { maxMS: 5 } }, 'check "a": unknown field `expect.maxMS`'],
    [{ name: 'a', url: '/a', expect: { status: 99 } }, 'check "a": `expect.status` must be a status code'],
    [{ name: 'a', url: '/a', expect: { status: [200, 200.5] } }, 'check "a": `expect.status`'],
    [{ name: 'a', url: '/a', expect: { status: [] } }, 'check "a": `expect.status`'],
    [{ name: 'a', url: '/a', expect: { maxMs: 0 } }, 'check "a": `expect.maxMs` must be a number from 1 to 120000'],
    [{ name: 'a', url: '/a', expect: { bodyIncludes: '' } }, 'check "a": `expect.bodyIncludes` must be a non-empty string'],
    [{ name: 'a', url: '/a', method: 'HEAD', expect: { bodyIncludes: 'x' } }, 'check "a": `expect.bodyIncludes` cannot be used with HEAD'],
    [{ name: 'a', url: '/a', expect: { status: 204, bodyIncludes: 'x' } }, 'check "a": `expect.bodyIncludes` cannot be used with status 204'],
    [{ name: 'a', url: '/a', expect: { status: [204, 304], bodyIncludes: 'x' } }, 'check "a": `expect.bodyIncludes` cannot be used with status 204 or 304'],
    [{ name: 'a', url: '/a', expect: { status: 205, bodyIncludes: 'x' } }, 'check "a": `expect.bodyIncludes` cannot be used with status 205'],

  ])('rejects %j', (raw, message) => {
    expect(() => validateCheck(raw)).toThrow(message)
  })

  it.each([['a function', () => ({})], ['a symbol', Symbol('x')], ['a BigInt inside', { n: 1n }]])('rejects a body that is not data: %s', (_what, body) => {
    expect(() => validateCheck({ name: 'a', url: '/a', method: 'POST', body })).toThrow('check "a": `body` cannot be sent as JSON')
  })

  it('wants an array with unique names', () => {
    expect(() => validateChecks({ name: 'a', url: '/a' })).toThrow('export default an array of checks')
    expect(() => validateChecks([{ name: 'a', url: '/a' }, { name: 'a', url: '/b' }])).toThrow('check "a" is defined twice')
    expect(validateChecks([])).toEqual([])
  })
})

describe('CheckRunner against a real HTTP server', () => {
  let server: Server
  let base: string
  const seen: { method?: string; url?: string; headers: IncomingMessage['headers']; body: string }[] = []

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      if (req.url === '/ok') return void res.writeHead(200, { 'content-type': 'application/json' }).end('[{"name":"Porto tile mug"}]')
      if (req.url === '/boom') return void res.writeHead(500).end('nope')
      if (req.url === '/login-wall') return void res.writeHead(302, { location: '/ok' }).end()
      if (req.url === '/refuse') return void res.writeHead(400).end('{"error":"quantity must be an integer from 1 to 10"}')
      if (req.url === '/hang') return // never answers
      if (req.url === '/events') return void res.writeHead(200, { 'content-type': 'text/event-stream' }).write('data: hello\n\n') // stays open
      if (req.url === '/slow-body') {
        res.writeHead(200).write('first')
        return void setTimeout(() => res.end('last'), 400)
      }
      if (req.url === '/ndjson') return void res.writeHead(200, { 'content-type': 'application/x-ndjson' }).write('{"type":"step"}\n') // stays open
      if (req.url === '/endless') return void res.writeHead(200).write('x'.repeat(MAX_BODY_BYTES + 10)) // a megabyte, then stays open
      if (req.url === '/big') return void res.writeHead(200).end(`${'x'.repeat(MAX_BODY_BYTES - 3)}needle-across-the-limit${'y'.repeat(2 * MAX_BODY_BYTES)}tail`)
      res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  afterEach(() => {
    seen.length = 0
  })

  const run = async (r: CheckRunner, check: Parameters<CheckRunner['run']>[0]): Promise<CheckResult> => {
    const result = await r.run(check)
    if (!result) throw new Error('no result')
    return result
  }

  const runner = (checks: unknown[], extra: Partial<ConstructorParameters<typeof CheckRunner>[0]> = {}) => {
    const list = validateChecks(checks)
    return { list, runner: new CheckRunner({ checks: list, baseUrl: `${base}/`, ...extra }) }
  }

  it('passes on a 2xx and sends its own trace id and mark', async () => {
    const { list, runner: r } = runner([{ name: 'catálogo', url: '/ok', headers: { traceparent: 'mine', 'x-observe-check': 'mine', 'x-team': 'web' } }])
    const result = await run(r, list[0])
    expect(result).toEqual({ atMs: expect.any(Number), ok: true, durationMs: expect.any(Number), status: 200, traceId: expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/ok' })
    expect(seen[0].headers.traceparent).toMatch(new RegExp(`^00-${result.traceId}-[0-9a-f]{16}-01$`))
    expect(seen[0].headers[CHECK_HEADER]).toBe('cat%C3%A1logo')
    expect(seen[0].headers['x-team']).toBe('web')
  })

  it('uses a fresh trace id for every run', async () => {
    const { list, runner: r } = runner([{ name: 'a', url: '/ok' }])
    expect((await run(r, list[0])).traceId).not.toBe((await run(r, list[0])).traceId)
  })

  it('fails on a status outside 2xx when none is expected', async () => {
    const { list, runner: r } = runner([{ name: 'a', url: '/boom' }])
    expect(await r.run(list[0])).toMatchObject({ ok: false, status: 500, reason: 'expected status 2xx, got 500' })
  })

  it('does not follow a redirect: the redirect is the answer', async () => {
    const { list, runner: r } = runner([{ name: 'guests go to login', url: '/login-wall', expect: { status: [301, 302] } }, { name: 'strict', url: '/login-wall' }])
    expect(await r.run(list[0])).toMatchObject({ ok: true, status: 302 })
    expect(await r.run(list[1])).toMatchObject({ ok: false, status: 302, reason: 'expected status 2xx, got 302' })
    expect(seen.map((s) => s.url)).toEqual(['/login-wall', '/login-wall'])
  })

  it('an expected refusal passes — and fails once the app starts accepting', async () => {
    const { list, runner: r } = runner([
      { name: 'junk is refused', url: '/refuse', method: 'POST', body: { quantity: 99 }, expect: { status: 400, bodyIncludes: 'quantity' } },
      { name: 'junk is refused (broken app)', url: '/ok', method: 'POST', body: { quantity: 99 }, expect: { status: [400, 422], bodyIncludes: 'quantity' } },
    ])
    expect(await r.run(list[0])).toMatchObject({ ok: true, status: 400 })
    expect(seen[0]).toMatchObject({ method: 'POST', body: '{"quantity":99}' })
    expect(seen[0].headers['content-type']).toBe('application/json')
    expect(await r.run(list[1])).toMatchObject({ ok: false, reason: 'expected status 400 or 422, got 200; body does not contain "quantity"' })
  })

  it('judges the time of the whole answer', async () => {
    let t = 1000
    const clock = () => (t += 400) // every reading is 400 ms later: start, then end
    // The wall clock jumping back (NTP, sleep) must not change the verdict: durations come from `elapsed`.
    let wall = 5000
    const { list, runner: r } = runner([{ name: 'fast enough', url: '/ok', expect: { maxMs: 400 } }, { name: 'too slow', url: '/ok', expect: { maxMs: 399 } }], { elapsed: clock, now: () => (wall -= 3000) })
    expect(await r.run(list[0])).toMatchObject({ ok: true, durationMs: 400, atMs: 2000 })
    expect(await r.run(list[1])).toMatchObject({ ok: false, durationMs: 400, reason: 'took 400 ms, limit 399 ms' })
  })

  it('the time limit covers the body, not just the headers', async () => {
    const { list, runner: r } = runner([{ name: 'slow body', url: '/slow-body', expect: { maxMs: 200 } }])
    const result = await run(r, list[0])
    expect(result).toMatchObject({ ok: false, status: 200 })
    expect(result.durationMs).toBeGreaterThanOrEqual(390)
  })

  it('gives up after the timeout', async () => {
    const { list, runner: r } = runner([{ name: 'a', url: '/hang', timeoutMs: 100 }])
    const result = await run(r, list[0])
    expect(result).toMatchObject({ ok: false, reason: 'no answer within 100 ms' })
    expect(result.status).toBeUndefined()
    // The request did arrive: the app has a trace of it.
    expect('unreachable' in result).toBe(false)
  })

  it('reports an app that is not there', async () => {
    const dead = createServer()
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const port = (dead.address() as AddressInfo).port
    await new Promise((resolve) => dead.close(resolve))
    const list = validateChecks([{ name: 'a', url: '/ok' }])
    const result = await new CheckRunner({ checks: list, baseUrl: `http://127.0.0.1:${port}` }).run(list[0])
    expect(result).toMatchObject({ ok: false, reason: 'request failed: ECONNREFUSED', unreachable: true })
  })

  it('only a connection that was never made means "no trace"; one that broke later may have one', async () => {
    const failing = (code: string) => (() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code } }))) as unknown as typeof fetch
    const list = validateChecks([{ name: 'a', url: '/a' }])
    const result = async (code: string) => new CheckRunner({ checks: list, baseUrl: 'http://app', fetch: failing(code) }).run(list[0])
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) expect(await result(code), code).toMatchObject({ ok: false, unreachable: true })
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED']) expect('unreachable' in (await result(code))!, code).toBe(false)
    const plain = await new CheckRunner({ checks: list, baseUrl: 'http://app', fetch: (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch }).run(list[0])
    expect(plain).toMatchObject({ ok: false, reason: 'request failed: boom' })
    expect('unreachable' in plain!).toBe(false)
  })

  it('a full URL ignores the base', async () => {
    const list = validateChecks([{ name: 'a', url: `${base}/ok` }])
    const r = new CheckRunner({ checks: list, baseUrl: 'http://127.0.0.1:1' })
    expect(await r.run(list[0])).toMatchObject({ ok: true })
    expect(r.list()[0].url).toBe(`${base}/ok`)
  })

  it('lists every check with its last result, history and failures in a row', async () => {
    const onResult = vi.fn()
    const { list, runner: r } = runner([{ name: 'flaky', url: '/boom', everySeconds: 30, expect: { status: 500 } }, { name: 'never ran', url: '/ok' }], { history: 3, onResult })
    expect(r.list()).toEqual([
      { name: 'flaky', method: 'GET', url: `${base}/boom`, everySeconds: 30, expect: { status: [500] }, failures: 0, history: [] },
      { name: 'never ran', method: 'GET', url: `${base}/ok`, everySeconds: 60, expect: {}, failures: 0, history: [] },
    ])
    const failing = { ...list[0], expect: {} }
    await r.run(list[0]) // ok
    await r.run(failing) // fails
    await r.run(failing) // fails
    expect(r.list()[0]).toMatchObject({ failures: 2, last: { ok: false, status: 500 } })
    expect(r.list()[0].history.map((h) => h.ok)).toEqual([true, false, false])
    expect(onResult.mock.calls.map((c) => c[2])).toEqual([0, 1, 2])
    await r.run(failing)
    expect(r.list()[0].history.map((h) => h.ok)).toEqual([false, false, false]) // only the last 3 kept
    await r.run(failing)
    // The streak is counted, not read off the 3 results that are kept.
    expect(r.list()[0].failures).toBe(4)
    expect(onResult.mock.calls.at(-1)?.[2]).toBe(4)
    await r.run(list[0])
    expect(r.list()[0]).toMatchObject({ failures: 0, last: { ok: true } })
  })

  it('remembers its own trace ids — their spans are not real traffic', async () => {
    const { list, runner: r } = runner([{ name: 'a', url: '/ok' }, { name: 'gone', url: '/hang', timeoutMs: 100 }])
    const ok = await run(r, list[0])
    const failed = await run(r, list[1])
    expect(r.isCheckTrace(ok.traceId)).toBe(true)
    expect(r.isCheckTrace(failed.traceId)).toBe(true)
    expect(r.isCheckTrace('0'.repeat(32))).toBe(false)
  })

  it('does not wait for an event stream to end', async () => {
    const { list, runner: r } = runner([{ name: 'events', url: '/events', timeoutMs: 1000, expect: { maxMs: 900 } }, { name: 'events text', url: '/events', timeoutMs: 1000, expect: { bodyIncludes: 'hello' } }])
    expect(await r.run(list[0])).toMatchObject({ ok: true, status: 200 })
    expect(await r.run(list[1])).toMatchObject({ ok: false, status: 200, reason: 'body does not contain "hello" (an event stream is not read)' })
  })

  it('does not read a body nobody asked about — any endless stream can be checked for its status', async () => {
    const { list, runner: r } = runner([{ name: 'ndjson', url: '/ndjson', timeoutMs: 1000, expect: { status: 200 } }])
    expect(await r.run(list[0])).toMatchObject({ ok: true, status: 200 })
  })

  it('a body that never finishes keeps the status it came with', async () => {
    const { list, runner: r } = runner([{ name: 'ndjson', url: '/ndjson', timeoutMs: 300, expect: { bodyIncludes: 'step' } }])
    const result = await run(r, list[0])
    expect(result).toMatchObject({ ok: false, status: 200, reason: 'the body did not finish within 300 ms' })
  })

  it('reads only the first megabyte of a body', async () => {
    const { list, runner: r } = runner([
      { name: 'start', url: '/big', expect: { bodyIncludes: 'xxxx' } },
      { name: 'cut', url: '/big', expect: { bodyIncludes: 'needle-across-the-limit' } },
      { name: 'end', url: '/big', expect: { bodyIncludes: 'tail' } },
    ])
    expect(await r.run(list[0])).toMatchObject({ ok: true })
    expect(await r.run(list[1])).toMatchObject({ ok: false, reason: 'body does not contain "needle-across-the-limit" in its first megabyte (the rest is not read)' })
    expect(await r.run(list[2])).toMatchObject({ ok: false, reason: 'body does not contain "tail" in its first megabyte (the rest is not read)' })
  })

  it('stops reading at the limit instead of waiting for the end of the body', async () => {
    const { list, runner: r } = runner([{ name: 'endless', url: '/endless', timeoutMs: 2000, expect: { bodyIncludes: 'xxx' } }])
    expect(await r.run(list[0])).toMatchObject({ ok: true, status: 200 })
  })

  it('stop drops the requests on their way: nothing recorded, nobody told', async () => {
    const onResult = vi.fn()
    const { list, runner: r } = runner([{ name: 'a', url: '/hang', timeoutMs: 5000 }], { onResult })
    const pending = r.run(list[0])
    await new Promise((resolve) => setTimeout(resolve, 50))
    const before = Date.now()
    r.stop()
    expect(await pending).toBeUndefined()
    expect(Date.now() - before).toBeLessThan(1000) // aborted, not waited out
    expect(r.list()[0]).toMatchObject({ failures: 0, history: [] })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('a run that answers after stop is not recorded either', async () => {
    const onResult = vi.fn()
    let release!: () => void
    const slow = vi.fn(() => new Promise<Response>((resolve) => (release = () => resolve(new Response('ok')))))
    const list = validateChecks([{ name: 'a', url: '/a' }])
    const r = new CheckRunner({ checks: list, baseUrl: 'http://app', fetch: slow as unknown as typeof fetch, onResult })
    const pending = r.run(list[0])
    r.stop()
    release()
    expect(await pending).toBeUndefined()
    expect(r.list()[0].history).toEqual([])
    expect(onResult).not.toHaveBeenCalled()
  })

  it('a throwing listener does not break the run', async () => {
    const { list, runner: r } = runner([{ name: 'a', url: '/ok' }], { onResult: () => { throw new Error('listener') } })
    expect(await r.run(list[0])).toMatchObject({ ok: true })
    expect(r.list()[0].history).toHaveLength(1)
  })
})

describe('CheckRunner: timers', () => {
  afterEach(() => vi.useRealTimers())

  const response = () => new Response('ok', { status: 200 })

  it('runs first after the start delay, then on its interval, until stopped', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: string) => response())
    const checks = validateChecks([{ name: 'a', url: '/a', everySeconds: 10 }, { name: 'b', url: '/b', everySeconds: 30 }])
    const r = new CheckRunner({ checks, baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 3000 })
    r.start()
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['http://app/a', 'http://app/b'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(['http://app/a', 'http://app/a', 'http://app/a', 'http://app/a', 'http://app/b', 'http://app/b'])
    r.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('stop before the first run cancels it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => response())
    const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a' }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch })
    r.start()
    r.stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('does not stack runs of a check whose answer is still on the way', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = () => resolve(response()))))
    // The timeout (60 s) is longer than the interval (5 s): the second tick finds the first still running.
    const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 5, timeoutMs: 60_000 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('a restart is not held back by a run left from before it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 5, timeoutMs: 60_000 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('nor by one whose request cannot be cancelled', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise<Response>(() => {})) // ignores the abort signal
    const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 5, timeoutMs: 60_000 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    r.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    r.stop()
  })

  describe('while the app is still starting', () => {
    const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))

    const failing = (code: string) => () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code } }))
    const make = (checks: unknown[], fetchMock: unknown, extra: Partial<ConstructorParameters<typeof CheckRunner>[0]> = {}) =>
      new CheckRunner({ checks: validateChecks(checks), baseUrl: 'http://app', fetch: fetchMock as typeof fetch, firstDelayMs: 0, ...extra })

    it('a refused connection is not a result until the grace time is over', async () => {
      vi.useFakeTimers()
      const onResult = vi.fn()
      const r = make([{ name: 'a', url: '/a', everySeconds: 10 }], vi.fn(refused), { startupGraceMs: 25_000, onResult })
      r.start()
      await vi.advanceTimersByTimeAsync(24_999)
      expect(r.list()[0]).toMatchObject({ failures: 0, history: [] })
      expect(onResult).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10_000) // past 25 s: nobody is listening, and that is the news
      expect(r.list()[0]).toMatchObject({ last: { ok: false, reason: 'request failed: ECONNREFUSED' } })
      expect(r.list()[0].failures).toBeGreaterThan(0)
      r.stop()
    })

    it('tries again soon, so a check with a long interval has its result as the app comes up', async () => {
      vi.useFakeTimers()
      let up = false
      const fetchMock = vi.fn(() => (up ? Promise.resolve(response()) : refused()))
      const r = make([{ name: 'hourly', url: '/a', everySeconds: 3600 }], fetchMock, { startupRetryMs: 5000 })
      r.start()
      await vi.advanceTimersByTimeAsync(12_000) // tries at 0, 5 and 10 s
      expect(fetchMock).toHaveBeenCalledTimes(3)
      up = true
      await vi.advanceTimersByTimeAsync(3000)
      expect(r.list()[0]).toMatchObject({ failures: 0, last: { ok: true } })
      await vi.advanceTimersByTimeAsync(600_000) // and no more retries after that
      expect(fetchMock).toHaveBeenCalledTimes(4)
      r.stop()
    })

    it('keeps one retry going, however many ticks met the starting app', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(refused)
      const r = make([{ name: 'a', url: '/a', everySeconds: 5 }], fetchMock, { startupRetryMs: 5000, startupGraceMs: 60_000 })
      r.start()
      await vi.advanceTimersByTimeAsync(30_000)
      // The interval alone gives 7 runs (0…30 s); the retries may add one per 5 s, not a growing pile.
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(14)
      r.stop()
    })

    it.each(['ENOTFOUND', 'CERT_HAS_EXPIRED'])('any other failure is news at once: %s', async (code) => {
      vi.useFakeTimers()
      const r = make([{ name: 'a', url: '/a' }], vi.fn(failing(code)))
      r.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(r.list()[0]).toMatchObject({ failures: 1, last: { reason: `request failed: ${code}` } })
      r.stop()
    })

    it('a check of another site gets no grace', async () => {
      vi.useFakeTimers()
      const r = make([{ name: 'partner', url: 'https://partner.example/health' }], vi.fn(refused))
      r.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(r.list()[0]).toMatchObject({ failures: 1 })
      r.stop()
    })

    it('another site answering does not end the grace time of the app', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn((url: string) => (url.startsWith('https://partner.example') ? Promise.resolve(response()) : refused()))
      const r = make([{ name: 'partner', url: 'https://partner.example/health', everySeconds: 10 }, { name: 'app', url: '/a', everySeconds: 10 }], fetchMock)
      r.start()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(r.list().map((c) => [c.name, c.history.length > 0, c.failures])).toEqual([['partner', true, 0], ['app', false, 0]])
      r.stop()
    })

    it('a new start gives the app its grace time again', async () => {
      vi.useFakeTimers()
      let up = true
      const r = make([{ name: 'a', url: '/a', everySeconds: 10 }], vi.fn(() => (up ? Promise.resolve(response()) : refused())))
      r.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(r.list()[0].history).toHaveLength(1)
      up = false
      r.start() // the observer restarted together with the app
      await vi.advanceTimersByTimeAsync(20_000)
      expect(r.list()[0].history).toHaveLength(1)
      r.stop()
    })

    it('measures the grace time on the clock that does not jump', async () => {
      vi.useFakeTimers()
      let wall = 1_000_000
      const r = make([{ name: 'a', url: '/a', everySeconds: 10 }], vi.fn(refused), { startupGraceMs: 25_000, now: () => (wall -= 60_000) })
      r.start()
      await vi.advanceTimersByTimeAsync(40_000)
      expect(r.list()[0].failures).toBeGreaterThan(0)
      r.stop()
    })

    it('once the app has answered, a refused connection counts at once', async () => {
      vi.useFakeTimers()
      let up = true
      const fetchMock = vi.fn(() => (up ? Promise.resolve(response()) : refused()))
      const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 10 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
      r.start()
      await vi.advanceTimersByTimeAsync(0)
      up = false
      await vi.advanceTimersByTimeAsync(10_000)
      expect(r.list()[0].history.map((h) => h.ok)).toEqual([true, false])
      r.stop()
    })

    it('a timeout counts even during the grace time: something is listening and not answering', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
      const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 10, timeoutMs: 1000 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
      r.start()
      await vi.advanceTimersByTimeAsync(1000)
      expect(r.list()[0]).toMatchObject({ failures: 1, last: { reason: 'no answer within 1000 ms' } })
      r.stop()
    })
  })

  it('start twice keeps one set of timers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => response())
    const r = new CheckRunner({ checks: validateChecks([{ name: 'a', url: '/a', everySeconds: 10 }]), baseUrl: 'http://app', fetch: fetchMock as unknown as typeof fetch, firstDelayMs: 0 })
    r.start()
    r.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    r.stop()
  })
})
