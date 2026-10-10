import { describe, expect, it } from 'vitest'
import type { EvidenceCard, NormalizedSpan } from '../src/collector/index.js'
import type { Defect } from '../src/collector/defects.js'
import { defectPrompt, reportPrompt, tracePrompt } from '../ui/src/lib/agent-prompt.js'
import { shopStorage } from './fixtures/shop.js'

async function shopTrace(filter: { operation: string; minDurationMs?: number; hasError?: boolean }) {
  const storage = await shopStorage()
  const [trace] = await storage.queryTraces({ ...filter, limit: 1 })
  return { traceId: trace.traceId, spans: await storage.getTrace(trace.traceId) }
}

const section = (prompt: string, title: string) => prompt.split(`## ${title}\n`)[1]?.split('\n## ')[0] ?? ''

describe('tracePrompt', () => {
  it('slow checkout: names the request, the version, where the time went and the file', async () => {
    const input = await shopTrace({ operation: 'POST /api/checkout', minDurationMs: 2000 })
    const prompt = tracePrompt({ ...input, usual: { p50Ms: 220, p95Ms: 320, calls: 30 } })
    expect(prompt).toContain(`\`POST /api/checkout\` took `)
    expect(prompt).toContain(`(shop@v2, trace \`${input.traceId}\`).`)
    expect(prompt).toContain('Usually: median 220ms, p95 320ms over 30 calls.')
    const time = section(prompt, 'Where the time went').split('\n').filter((l) => l.startsWith('- '))
    // Biggest own time first, with its file; Next's internal step is not listed.
    expect(time[0]).toMatch(/^- `chargePayment`: \d\.\d\ds \(9\d%\), `lib\/payment\.ts`$/)
    expect(time.join('\n')).not.toContain('executing api route')
    expect(prompt).not.toContain('## Errors')
    expect(prompt).not.toContain('## Repeated calls')
    expect(section(prompt, 'Task')).toContain('find what makes it slow')
  })

  it('N+1: says which operation is repeated, how often and by whom', async () => {
    const prompt = tracePrompt(await shopTrace({ operation: 'GET /api/products' }))
    expect(section(prompt, 'Repeated calls')).toMatch(/^- `db\.query` is called 5 times by `.+` \(90ms in total\)\n?$/)
    expect(section(prompt, 'Where the time went')).toContain('`db.query`: 90ms (')
    expect(section(prompt, 'Where the time went')).toContain(', 5 calls')
  })

  it('a failed request: the exception where it was thrown, once, and a task about the error', async () => {
    const prompt = tracePrompt(await shopTrace({ operation: 'GET /api/inventory/[id]', hasError: true }))
    expect(prompt).toMatch(/`GET \/api\/inventory\/\[id\]` failed after \d+ms/)
    const errors = section(prompt, 'Errors').split('\n').filter((l) => l.startsWith('- '))
    expect(errors).toEqual(['- `inventory.check` (`app/api/inventory/[id]/route.ts`): Inventory service timeout: upstream not responding'])
    expect(section(prompt, 'Task')).toContain('find why it throws')
  })

  const span = (over: Partial<NormalizedSpan>): NormalizedSpan => ({
    traceId: 't'.repeat(32),
    spanId: 's1',
    parentSpanId: null,
    name: 'GET /api/x',
    kind: 'server',
    service: 'shop',
    serviceVersion: null,
    scope: null,
    startTimeMs: 0,
    durationMs: 50,
    status: 'unset',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: [],
    ...over,
  })

  it('includes the exception type and the top of the stack; says when it was a cold start', () => {
    const stack = ['TypeError: x is undefined', ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (file.ts:${i})`)].join('\n')
    const failing = span({
      spanId: 's2',
      parentSpanId: 's1',
      name: 'applyCoupon',
      kind: 'internal',
      status: 'error',
      events: [{ name: 'exception', timeMs: 1, attributes: { 'exception.type': 'TypeError', 'exception.message': 'x is undefined', 'exception.stacktrace': stack } }],
    })
    // The route failed too, with its own status message — but the exception belongs to applyCoupon and is listed once.
    const prompt = tracePrompt({ traceId: 'abc', spans: [{ ...span({ status: 'error', statusMessage: 'Internal Server Error' }), coldStart: true }, failing] })
    expect(prompt).toContain('- `applyCoupon`: TypeError: x is undefined')
    expect(section(prompt, 'Errors').split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1)
    expect(prompt).toContain('    at frame6 (file.ts:6)')
    expect(prompt).not.toContain('frame7')
    expect(prompt).toContain('(shop, trace `abc`)') // no version → just the service
    expect(prompt).toContain('its time includes compiling the route')
  })

  it('two calls of the same operation are not an N+1; three are', () => {
    const call = (id: string) => span({ spanId: id, parentSpanId: 's1', name: 'getProductById', kind: 'internal', durationMs: 10 })
    expect(tracePrompt({ traceId: 'abc', spans: [span({}), call('a'), call('b')] })).not.toContain('## Repeated calls')
    expect(section(tracePrompt({ traceId: 'abc', spans: [span({}), call('a'), call('b'), call('c')] }), 'Repeated calls')).toContain('`getProductById` is called 3 times by `GET /api/x`')
  })

  it('only framework spans: listed rather than an empty prompt; no spans: empty', () => {
    const only = span({ name: 'executing api route (app) /api/x', kind: 'internal', attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' } })
    expect(section(tracePrompt({ traceId: 'abc', spans: [only] }), 'Where the time went')).toContain('`executing api route (app) /api/x`')
    expect(tracePrompt({ traceId: 'abc', spans: [] })).toBe('')
  })
})

describe('defectPrompt', () => {
  const defect: Defect = {
    id: 'x',
    service: 'shop',
    operation: 'applyCoupon',
    spanName: 'applyCoupon',
    source: 'server',
    category: 'code',
    pages: [],
    message: "Cannot read properties of undefined (reading 'discount')",
    type: 'TypeError',
    count: 7,
    series: [],
    firstSeenMs: 0,
    lastSeenMs: 0,
    firstSeenVersion: 'v2',
    versions: ['v2'],
    isNew: true,
    affected: [{ service: 'shop', operation: 'POST /api/checkout', spanName: 'POST /api/checkout', count: 7 }],
    exampleTraceIds: ['aaa', 'bbb'],
  }

  it('a new defect: message, what fails because of it, and a task pointing at the deploy', () => {
    const prompt = defectPrompt(defect)
    expect(prompt).toContain("```\nTypeError: Cannot read properties of undefined (reading 'discount')\n```")
    expect(prompt).toContain('7 occurrences in the selected window.')
    expect(prompt).toContain('Requests failing because of it: `POST /api/checkout` (7).')
    expect(prompt).toContain('It first appeared in version v2')
    expect(prompt).toContain('Example traces: `aaa`, `bbb`.')
    expect(section(prompt, 'Task')).toContain('what changed in v2')
  })

  it('a browser error: where it happened and what kind, and a task about the client code — not "where is `uncaught error` implemented"', () => {
    const prompt = defectPrompt({ ...defect, operation: 'uncaught error', spanName: 'uncaught error', source: 'browser', category: 'browser-error', pages: [{ path: '/product/3', count: 2 }], affected: [], isNew: false })
    expect(section(prompt, 'Problem')).toContain('In the browser (service shop), on `/product/3`, this was recorded as "uncaught error":')
    expect(section(prompt, 'Task')).toContain('1. Find the client code on that page that can produce this error')
    expect(prompt).not.toContain('is implemented')
  })

  it('a failing request: named as a request, and the task looks at both the caller and the route', () => {
    const prompt = defectPrompt({ ...defect, operation: 'GET /api/coupons/:id', spanName: 'GET', source: 'browser', category: 'request', message: 'HTTP 404', type: null, affected: [], isNew: false })
    expect(section(prompt, 'Problem')).toContain("The browser's request `GET /api/coupons/:id` (service shop) fails with:")
    expect(section(prompt, 'Task')).toContain('1. Find where the app makes this request and the route that should answer it')
    expect(prompt).not.toContain('is implemented')
  })

  it('an old defect: its versions, no deploy to blame', () => {
    const prompt = defectPrompt({ ...defect, isNew: false, firstSeenVersion: 'v1', versions: ['v1', 'v2'], type: null, count: 1, affected: [] })
    expect(prompt).toContain('Seen in versions v1, v2; first seen in v1.')
    expect(prompt).toContain('1 occurrence in the selected window.')
    expect(prompt).not.toContain('Requests failing because of it')
    expect(prompt).not.toContain('what changed in')
    expect(prompt).toContain("```\nCannot read properties")
  })
})

describe('reportPrompt', () => {
  const version = (v: string, p95Ms: number) => ({ version: v, count: 30, p50Ms: 200, p95Ms, errorRate: 0 })
  const cards: EvidenceCard[] = [
    { kind: 'regression', service: 'shop', operation: 'POST /api/checkout', from: version('v1', 320), to: version('v2', 2510), p95Ratio: 7.8, errorRateDelta: 0 },
    { kind: 'hotspot', operation: 'chargePayment', traceId: 'abc', selfMs: 2490, traceMs: 2510, codeFile: 'lib/payment.ts' },
    { kind: 'hotspot', operation: 'chargePayment', traceId: 'abc', selfMs: 2490, traceMs: 2510, codeFile: 'lib/payment.ts' },
    { kind: 'traces', label: 'Recent traces', traces: [] },
  ]

  it('measured evidence first (deduplicated), then the diagnosis marked as a model’s reading', () => {
    const prompt = reportPrompt('Why is checkout slow?', '  chargePayment got slower in v2.  ', cards)
    expect(section(prompt, 'Problem').trim()).toBe('Why is checkout slow?')
    expect(section(prompt, 'Measured').trim().split('\n')).toEqual([
      '- `POST /api/checkout` (shop): p95 320ms in v1 → 2.51s in v2 (×7.8); error rate 0% → 0%.',
      '- `chargePayment` spends 2.49s of a 2.51s request in its own code — `lib/payment.ts` (trace `abc`).',
    ])
    expect(prompt.indexOf('## Measured')).toBeLessThan(prompt.indexOf('## Diagnosis by the observability agents'))
    expect(section(prompt, 'Diagnosis by the observability agents')).toContain('check it against the code')
    expect(section(prompt, 'Diagnosis by the observability agents')).toContain('\nchargePayment got slower in v2.\n')
  })

  it('an error card without a message adds nothing and is left out', () => {
    const failing = (operation: string, message: string): EvidenceCard => ({ kind: 'errors', service: 'shop', operation, errors: 5, errorRate: 0.3, message, traceIds: ['abc'] })
    const measured = section(reportPrompt('q', 'r', [failing('inventory.check', 'Inventory service timeout'), failing('GET /api/inventory/[id]', '(no message)')]), 'Measured')
    expect(measured.trim()).toBe('- `inventory.check` (shop) fails in 30% of calls: "Inventory service timeout". Example traces: `abc`.')
  })

  it('without cards there is no Measured section', () => {
    expect(reportPrompt('q', 'r', [])).not.toContain('## Measured')
  })
})
