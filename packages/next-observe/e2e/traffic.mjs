// Live traffic for the detector demo: OTLP/JSON server spans of the "shop" service (v2), in phases.
//   node e2e/traffic.mjs healthy 20 failing 40      → 20 s healthy, then 40 s with 40% inventory errors
//   phases: healthy | failing (40% inventory errors) | slow (40% checkouts > 2 s)
//   COLLECTOR_URL (default http://127.0.0.1:4318), RPS (default 4)
const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://127.0.0.1:4318'
const RPS = Number(process.env.RPS ?? 4)
const args = process.argv.slice(2)
const phases = []
for (let i = 0; i < args.length; i += 2) phases.push({ kind: args[i], seconds: Number(args[i + 1]) })
if (phases.length === 0 || phases.some((p) => !['healthy', 'failing', 'slow'].includes(p.kind) || !(p.seconds > 0))) {
  console.error('usage: node e2e/traffic.mjs <healthy|failing|slow> <seconds> [...]')
  process.exit(1)
}

let seq = Date.now() % 1_000_000
const hex = (n, len) => n.toString(16).padStart(len, '0').slice(-len)
const attr = (key, value) => ({ key, value: typeof value === 'number' ? { intValue: value } : { stringValue: String(value) } })

function span(route, { error = false, durationMs = 40 } = {}) {
  seq++
  const end = BigInt(Date.now()) * 1_000_000n
  const start = end - BigInt(Math.round(durationMs * 1_000_000))
  return {
    traceId: hex(seq, 32),
    spanId: hex(seq, 16),
    name: route,
    kind: 2, // SERVER
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    attributes: [attr('http.route', route.split(' ')[1]), attr('http.status_code', error ? 500 : 200)],
    status: error ? { code: 2, message: 'Inventory service timeout: upstream not responding' } : { code: 0 },
    events: error
      ? [{ name: 'exception', timeUnixNano: String(end), attributes: [attr('exception.message', 'Inventory service timeout: upstream not responding')] }]
      : [],
  }
}

function request(kind, i) {
  if (kind === 'failing' && i % 5 < 2) return span('GET /api/inventory/[id]', { error: true, durationMs: 15 })
  if (kind === 'slow' && i % 5 < 2) return span('POST /api/checkout', { durationMs: 2300 + (i % 3) * 100 })
  return span(['GET /', 'GET /api/products', 'GET /api/inventory/[id]', 'POST /api/checkout'][i % 4], { durationMs: 30 + (i % 7) * 10 })
}

async function send(spans) {
  const body = {
    resourceSpans: [{ resource: { attributes: [attr('service.name', 'shop'), attr('service.version', 'v2')] }, scopeSpans: [{ scope: { name: 'traffic' }, spans }] }],
  }
  const res = await fetch(`${COLLECTOR}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`collector answered ${res.status}`)
}

let i = 0
for (const phase of phases) {
  console.log(`[traffic] ${phase.kind} for ${phase.seconds}s at ${RPS} req/s`)
  const until = Date.now() + phase.seconds * 1000
  while (Date.now() < until) {
    await send(Array.from({ length: RPS }, () => request(phase.kind, i++)))
    await new Promise((r) => setTimeout(r, 1000))
  }
}
console.log(`[traffic] done, ${i} requests`)
