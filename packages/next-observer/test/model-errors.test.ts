import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BaseLlm, LLMRegistry, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk'
import { afterEach, describe, expect, it } from 'vitest'
import { explainModelError, isTransient, parseModelError } from '../src/agents/model-errors.js'
import { ResilientLlm } from '../src/agents/resilient-llm.js'

const apiError = (status: number, body: unknown) => Object.assign(new Error(typeof body === 'string' ? body : JSON.stringify(body)), { status })
const rateLimited = (retryDelay?: string) =>
  apiError(429, { error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED', ...(retryDelay ? { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } : {}) } })
const noCredits = apiError(402, { error: { code: 402, message: 'Your prepayment credits are depleted. ', status: 'RESOURCE_EXHAUSTED' } })

describe('parseModelError', () => {
  it('reads status, the provider message and its retry delay from the API body', () => {
    expect(parseModelError(rateLimited('7.5s'))).toEqual({ status: 429, message: 'You exceeded your current quota.', retryAfterMs: 7500 })
    expect(parseModelError(noCredits)).toEqual({ status: 402, message: 'Your prepayment credits are depleted.' })
  })

  it('finds "retry in N s" in the text when there is no RetryInfo; plain errors pass through', () => {
    expect(parseModelError(apiError(429, 'Quota exceeded. Please retry in 12.3s.'))).toEqual({ status: 429, message: 'Quota exceeded. Please retry in 12.3s.', retryAfterMs: 12_300 })
    expect(parseModelError(new Error('socket hang up'))).toEqual({ message: 'socket hang up' })
    expect(parseModelError('boom')).toEqual({ message: 'boom' })
  })

  it('transient: rate limit and server-side failures — not credits, keys or a wrong model', () => {
    expect([429, 500, 502, 503, 504].every((status) => isTransient({ status, message: '' }))).toBe(true)
    expect([400, 401, 402, 403, 404, undefined].some((status) => isTransient({ status, message: '' }))).toBe(false)
  })
})

describe('explainModelError', () => {
  it('says what to do, then quotes the provider', () => {
    expect(explainModelError({ status: 402, message: 'Your prepayment credits are depleted.' })).toBe(
      'The model provider refused the request: the account has no credits left. Top up the account or use another API key, then ask again. Provider: Your prepayment credits are depleted.',
    )
    expect(explainModelError({ status: 429, message: 'Quota exceeded.', retryAfterMs: 7200 }, 3)).toBe(
      "The model's rate limit is reached (tried 3 times) — ask again in about 8s. Free tiers allow only a few requests per minute, and one investigation makes several. Provider: Quota exceeded.",
    )
    expect(explainModelError({ status: 429, message: '' })).toContain('ask again in a minute.')
    expect(explainModelError({ status: 403, message: 'API key not valid.' })).toContain('check GEMINI_API_KEY')
    expect(explainModelError({ status: 401, message: '' })).toContain('check GEMINI_API_KEY')
    expect(explainModelError({ status: 404, message: 'models/x is not found' })).toContain('check the model name in GEMINI_MODEL')
    expect(explainModelError({ status: 503, message: 'overloaded' }, 2)).toBe('The model provider is overloaded or unavailable (tried 2 times) — ask again in a minute. Provider: overloaded')
    expect(explainModelError({ message: 'socket hang up' })).toBe('socket hang up')
  })
})

const text = (t: string): LlmResponse => ({ content: { role: 'model', parts: [{ text: t }] }, turnComplete: true })
const request = { contents: [], toolsDict: {} } as unknown as LlmRequest

/** Throws the scripted errors one per call, then answers. */
class Flaky extends BaseLlm {
  calls = 0
  constructor(private readonly failures: unknown[]) {
    super({ model: 'flaky' })
  }
  async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
    const failure = this.failures[this.calls++]
    if (failure) throw failure
    yield text('answer')
  }
  async connect(): Promise<BaseLlmConnection> {
    throw new Error('no live')
  }
}

async function ask(inner: BaseLlm, options: ConstructorParameters<typeof ResilientLlm>[1] = {}) {
  const waits: number[] = []
  const retries: string[] = []
  const llm = new ResilientLlm(inner, { sleep: async (ms) => void waits.push(ms), onRetry: (i) => retries.push(`${i.attempt}/${i.attempts} ${i.reason}`), ...options })
  const out: string[] = []
  let error: string | undefined
  try {
    for await (const r of llm.generateContentAsync(request)) out.push(r.content!.parts![0].text!)
  } catch (e) {
    error = (e as Error).message
  }
  return { out, error, waits, retries }
}

describe('ResilientLlm on provider errors', () => {
  it('rate limited: waits as long as the provider asked, then the same call succeeds', async () => {
    const inner = new Flaky([rateLimited('7s'), rateLimited('2.5s')])
    const r = await ask(inner)
    expect(r.out).toEqual(['answer'])
    expect(r.waits).toEqual([7000, 2500])
    expect(r.retries).toEqual(['2/3 rate limit reached (429), waiting 7s', '3/3 rate limit reached (429), waiting 3s'])
    expect(inner.calls).toBe(3)
  })

  it('without a hint from the provider: 2 s, then 6 s', async () => {
    const r = await ask(new Flaky([apiError(503, { error: { code: 503, message: 'overloaded' } }), rateLimited()]))
    expect(r.waits).toEqual([2000, 6000])
    expect(r.retries[0]).toBe('2/3 provider unavailable (503), waiting 2s')
  })

  it('still limited after the last attempt: the error in plain words, with how often it tried', async () => {
    const inner = new Flaky([rateLimited('1s'), rateLimited('1s'), rateLimited('1s'), undefined])
    const r = await ask(inner)
    expect(r.out).toEqual([])
    expect(r.error).toMatch(/^The model's rate limit is reached \(tried 3 times\) — ask again in about 1s\./)
    expect(inner.calls).toBe(3)
  })

  it('a wait longer than the limit (a daily quota) is not worth it: reported at once', async () => {
    const inner = new Flaky([rateLimited('3600s')])
    const r = await ask(inner)
    expect(r.waits).toEqual([])
    expect(r.error).toContain('ask again in about 3600s')
    expect(inner.calls).toBe(1)
    // …and exactly at the limit it still waits.
    expect((await ask(new Flaky([rateLimited('60s')]))).waits).toEqual([60_000])
    expect((await ask(new Flaky([rateLimited('61s')]))).waits).toEqual([])
    // A per-minute quota — what Gemini's free tier really answers ("retry in 52.15s") — is waited for.
    expect((await ask(new Flaky([rateLimited('52.151747838s')]))).out).toEqual(['answer'])
  })

  it('no credits, a bad key, a wrong model: no retry, an explanation instead', async () => {
    const inner = new Flaky([noCredits])
    const r = await ask(inner)
    expect(inner.calls).toBe(1)
    expect(r.waits).toEqual([])
    expect(r.error).toContain('the account has no credits left')
    expect(r.error).toContain('Provider: Your prepayment credits are depleted.')
  })

  it('an error without a status is rethrown exactly as it came', async () => {
    const original = new Error('socket hang up')
    const llm = new ResilientLlm(new Flaky([original]))
    await expect((async () => { for await (const _ of llm.generateContentAsync(request)) void _ })()).rejects.toBe(original)
  })

  it('rate limited after part of the answer went out: no second call — it would repeat the first part', async () => {
    class HalfThenLimited extends Flaky {
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        this.calls++
        yield text('first half')
        throw rateLimited('1s')
      }
    }
    const inner = new HalfThenLimited([])
    const r = await ask(inner)
    expect(r.out).toEqual(['first half'])
    expect(r.error).toMatch(/^The model's rate limit is reached — /)
    expect(inner.calls).toBe(1)
    expect(r.waits).toEqual([])
  })

  it('hangs and provider errors are counted apart: rate limited, then a hang, then the answer', async () => {
    class LimitedThenHangs extends Flaky {
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        const call = ++this.calls
        if (call === 1) throw rateLimited('1s')
        if (call === 2) await new Promise<never>(() => {})
        yield text('answer')
      }
    }
    const inner = new LimitedThenHangs([])
    // attempts: 2 → one hang may be repeated; the rate-limit retry before it must not use that up.
    const r = await ask(inner, { callTimeoutMs: 30, attempts: 2 })
    expect(r.out).toEqual(['answer'])
    expect(inner.calls).toBe(3)
    expect(r.retries).toEqual(['2/3 rate limit reached (429), waiting 1s', '2/2 no answer within 0s'])
  })

  it('transientAttempts: 1 turns retries off', async () => {
    const inner = new Flaky([rateLimited('1s')])
    const r = await ask(inner, { transientAttempts: 1 })
    expect(inner.calls).toBe(1)
    expect(r.error).toMatch(/^The model's rate limit is reached — /)
  })
})

describe('the real ADK Gemini client against a fake API', () => {
  let server: Server | undefined
  const saved = { base: process.env.GOOGLE_GEMINI_BASE_URL, key: process.env.GEMINI_API_KEY }
  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)))
    server = undefined
    for (const [name, value] of [['GOOGLE_GEMINI_BASE_URL', saved.base], ['GEMINI_API_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  async function fakeGemini(statuses: number[]) {
    let hits = 0
    server = createServer((req, res) => {
      req.resume()
      const status = statuses[hits++] ?? 200
      const body =
        status === 200
          ? { candidates: [{ content: { role: 'model', parts: [{ text: 'checkout is slow because of chargePayment' }] }, finishReason: 'STOP' }] }
          : status === 429
            ? { error: { code: 429, message: 'You exceeded your current quota. Please retry in 1s.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } }
            : { error: { code: 402, message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' } }
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    process.env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.GEMINI_API_KEY = 'not-a-real-key'
    return { hits: () => hits, llm: LLMRegistry.newLlm('gemini-2.5-flash') }
  }
  const geminiRequest = { contents: [{ role: 'user', parts: [{ text: 'why is checkout slow?' }] }], toolsDict: {}, config: {} } as unknown as LlmRequest

  it('429 twice, then an answer: the investigation goes on', async () => {
    const { hits, llm } = await fakeGemini([429, 429])
    const waits: number[] = []
    const out: string[] = []
    for await (const r of new ResilientLlm(llm, { sleep: async (ms) => void waits.push(ms) }).generateContentAsync(geminiRequest)) out.push(r.content?.parts?.[0]?.text ?? '')
    expect(out.join('')).toBe('checkout is slow because of chargePayment')
    expect(waits).toEqual([1000, 1000])
    expect(hits()).toBe(3)
  })

  it('402 "credits depleted" — what this project’s test key answers: explained, not retried', async () => {
    const { hits, llm } = await fakeGemini([402])
    const run = (async () => { for await (const _ of new ResilientLlm(llm).generateContentAsync(geminiRequest)) void _ })()
    await expect(run).rejects.toThrow('the account has no credits left. Top up the account or use another API key, then ask again. Provider: Your prepayment credits are depleted.')
    expect(hits()).toBe(1)
  })
})
