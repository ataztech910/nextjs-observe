// Deterministic "shop" telemetry mirroring the workshop scenario — for tests and for `next-observer collector --demo`:
//   v1 deployed, then v2 where chargePayment got ~8x slower; inventory.check fails 30% of the time; the catalog has an N+1.
import type { NormalizedSpan, StorageAdapter } from '../collector/types.js'

const MIN = 60_000

let seq = 0
const id = (length: number) => (++seq).toString(16).padStart(length, '0')

function span(traceId: string, parent: NormalizedSpan | null, name: string, startTimeMs: number, durationMs: number, extra: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    traceId,
    spanId: id(16),
    parentSpanId: parent?.spanId ?? null,
    name,
    kind: parent ? 'internal' : 'server',
    service: 'shop',
    serviceVersion: parent?.serviceVersion ?? 'v1',
    scope: 'test',
    startTimeMs,
    durationMs,
    status: 'unset',
    statusMessage: null,
    attributes: {},
    resource: {},
    events: [],
    ...extra,
  }
}

// Like a real Next.js app: the request span (kind server) and Next's own "executing api route" step around user code.
const nextRequest = { 'next.span_type': 'BaseServer.handleRequest' }
function nextRoute(t: string, root: NormalizedSpan, at: number, durationMs: number, extra: Partial<NormalizedSpan> = {}): NormalizedSpan {
  const route = String(root.attributes['http.route'])
  return span(t, root, `executing api route (app) ${route}`, at, durationMs, { ...extra, attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler', 'next.route': route } })
}

function checkout(version: string, at: number, paymentMs: number): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'POST /api/checkout', at, paymentMs + 20, { serviceVersion: version, attributes: { ...nextRequest, 'http.route': '/api/checkout', 'http.status_code': 200 } })
  const route = nextRoute(t, root, at + 5, paymentMs + 10)
  return [root, route, span(t, route, 'chargePayment', at + 10, paymentMs, { attributes: { 'code.filepath': 'lib/payment.ts', 'code.function': 'chargePayment' } })]
}

function inventory(version: string, at: number, fails: boolean): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'GET /api/inventory/[id]', at, 15, {
    serviceVersion: version,
    status: fails ? 'error' : 'unset',
    attributes: { ...nextRequest, 'http.route': '/api/inventory/[id]', 'http.status_code': fails ? 500 : 200 },
  })
  const route = nextRoute(t, root, at + 1, 12, { status: fails ? 'error' : 'unset', statusMessage: fails ? 'Inventory service timeout: upstream not responding' : null })
  const check = span(t, route, 'inventory.check', at + 2, 10, {
    status: fails ? 'error' : 'unset',
    statusMessage: fails ? 'Inventory service timeout: upstream not responding' : null,
    attributes: { 'code.filepath': 'app/api/inventory/[id]/route.ts' },
    events: fails ? [{ name: 'exception', timeMs: at + 12, attributes: { 'exception.message': 'Inventory service timeout: upstream not responding' } }] : [],
  })
  return [root, route, check]
}

function catalog(version: string, at: number): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'GET /api/products', at, 120, { serviceVersion: version, attributes: { ...nextRequest, 'http.route': '/api/products' } })
  const route = nextRoute(t, root, at + 1, 118)
  const ids = span(t, route, 'getProductIds', at + 1, 8)
  const queries = [0, 1, 2, 3, 4].map((i) => span(t, route, 'db.query', at + 10 + i * 20, 18, { attributes: { 'db.statement': 'SELECT * FROM products WHERE id = ?' } }))
  return [root, route, ids, ...queries]
}

const PAYMENT_V1 = [160, 180, 200, 240, 260, 300]
const PAYMENT_V2 = [1400, 1450, 1600, 2100, 2380, 2490]

export function demoSpans(now: number = Date.now()): NormalizedSpan[] {
  seq = 0
  const spans: NormalizedSpan[] = []
  // v1: 12–8 minutes ago
  for (let i = 0; i < 30; i++) {
    const at = now - 12 * MIN + i * 8_000
    spans.push(...checkout('v1', at, PAYMENT_V1[i % PAYMENT_V1.length]))
    spans.push(...inventory('v1', at + 1000, i % 10 < 3))
    if (i % 5 === 0) spans.push(...catalog('v1', at + 2000))
  }
  // v2: 5–1 minutes ago (fresh enough not to look like a silent service)
  for (let i = 0; i < 30; i++) {
    const at = now - 5 * MIN + i * 8_000
    spans.push(...checkout('v2', at, PAYMENT_V2[i % PAYMENT_V2.length]))
    spans.push(...inventory('v2', at + 1000, i % 10 < 3))
    if (i % 5 === 0) spans.push(...catalog('v2', at + 2000))
  }
  // Old data outside the default 15-minute window (seedDemo inserts these 3 spans first).
  spans.push(...checkout('v0', now - 40 * MIN, 50))
  return spans
}

/** Inserts the demo scenario. Old v0 data goes first so deploy order is v0 → v1 → v2. */
export async function seedDemo(storage: StorageAdapter, now: number = Date.now()): Promise<void> {
  const spans = demoSpans(now)
  await storage.insertSpans([...spans.slice(-3), ...spans.slice(0, -3)])
}

export interface LiveDemoOptions {
  storage: StorageAdapter
  /** Gets the same spans as ingested traffic would give it. */
  detector?: { observe(spans: NormalizedSpan[]): void }
  /** Default 2000. */
  intervalMs?: number
  now?: () => number
}

/** One tick of v2 traffic, with the same three bugs: slow payment, 30% inventory failures, the catalog N+1. */
export function liveDemoSpans(now: number, tick: number): NormalizedSpan[] {
  return [
    ...checkout('v2', now, PAYMENT_V2[tick % PAYMENT_V2.length]),
    // 3 in 10, spread out like random failures (ticks 2, 5, 8): three in a row — or one in the first ticks, while the
    // detector's window still holds few requests — would look like an app-wide error spike instead of a broken endpoint.
    ...inventory('v2', now + 100, [2, 5, 8].includes(tick % 10)),
    ...(tick % 5 === 0 ? catalog('v2', now + 200) : []),
  ]
}

/**
 * Keeps `--demo` alive: without new traffic the shop looks silent after a few minutes and nothing triggers the detector.
 * Returns stop(); call it before closing the collector.
 */
export function startLiveDemo(options: LiveDemoOptions): () => void {
  const now = options.now ?? Date.now
  let tick = 0
  const timer = setInterval(() => {
    const spans = liveDemoSpans(now(), tick++)
    void options.storage.insertSpans(spans).then(() => options.detector?.observe(spans))
  }, options.intervalMs ?? 2000)
  timer.unref()
  return () => clearInterval(timer)
}
