// Deterministic "shop" telemetry mirroring the workshop scenario:
//   v1 deployed, then v2 where chargePayment got ~8x slower; inventory.check fails 30% of the time; the catalog has an N+1.
import { MemoryStorage } from '../../src/collector/memory-storage.js'
import type { NormalizedSpan } from '../../src/collector/types.js'

export const NOW = 1_800_000_000_000
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

function checkout(version: string, at: number, paymentMs: number): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'POST /api/checkout', at, paymentMs + 20, { serviceVersion: version, attributes: { 'http.route': '/api/checkout', 'http.status_code': 200 } })
  return [root, span(t, root, 'chargePayment', at + 10, paymentMs, { attributes: { 'code.filepath': 'lib/payment.ts', 'code.function': 'chargePayment' } })]
}

function inventory(version: string, at: number, fails: boolean): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'GET /api/inventory/[id]', at, 15, {
    serviceVersion: version,
    status: fails ? 'error' : 'unset',
    attributes: { 'http.route': '/api/inventory/[id]', 'http.status_code': fails ? 500 : 200 },
  })
  const check = span(t, root, 'inventory.check', at + 2, 10, {
    status: fails ? 'error' : 'unset',
    statusMessage: fails ? 'Inventory service timeout: upstream not responding' : null,
    attributes: { 'code.filepath': 'app/api/inventory/[id]/route.ts' },
    events: fails ? [{ name: 'exception', timeMs: at + 12, attributes: { 'exception.message': 'Inventory service timeout: upstream not responding' } }] : [],
  })
  return [root, check]
}

function catalog(version: string, at: number): NormalizedSpan[] {
  const t = id(32)
  const root = span(t, null, 'GET /api/products', at, 120, { serviceVersion: version, attributes: { 'http.route': '/api/products' } })
  const ids = span(t, root, 'getProductIds', at + 1, 8)
  const queries = [0, 1, 2, 3, 4].map((i) => span(t, root, 'db.query', at + 10 + i * 20, 18, { attributes: { 'db.statement': 'SELECT * FROM products WHERE id = ?' } }))
  return [root, ids, ...queries]
}

const PAYMENT_V1 = [160, 180, 200, 240, 260, 300]
const PAYMENT_V2 = [1400, 1450, 1600, 2100, 2380, 2490]

export function shopSpans(): NormalizedSpan[] {
  const spans: NormalizedSpan[] = []
  // v1: 12–8 minutes ago
  for (let i = 0; i < 30; i++) {
    const at = NOW - 12 * MIN + i * 8_000
    spans.push(...checkout('v1', at, PAYMENT_V1[i % PAYMENT_V1.length]))
    spans.push(...inventory('v1', at + 1000, i % 10 < 3))
    if (i % 5 === 0) spans.push(...catalog('v1', at + 2000))
  }
  // v2: 6–2 minutes ago
  for (let i = 0; i < 30; i++) {
    const at = NOW - 6 * MIN + i * 8_000
    spans.push(...checkout('v2', at, PAYMENT_V2[i % PAYMENT_V2.length]))
    spans.push(...inventory('v2', at + 1000, i % 10 < 3))
    if (i % 5 === 0) spans.push(...catalog('v2', at + 2000))
  }
  // Old data outside the default 15-minute window.
  spans.push(...checkout('v0', NOW - 40 * MIN, 50))
  return spans
}

export async function shopStorage(): Promise<MemoryStorage> {
  const storage = new MemoryStorage()
  // Old v0 data arrives first so deploy order is v0 → v1 → v2.
  const spans = shopSpans()
  await storage.insertSpans([...spans.slice(-2), ...spans.slice(0, -2)])
  return storage
}
