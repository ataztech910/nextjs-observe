// E2E checks against a running collector's query API, after this scenario in the test app:
// open /observe, click the counter twice, submit the server action.
//   COLLECTOR_URL (default http://127.0.0.1:4318)  EXPECT_SERVICE (default vercel-otel-test)  EXPECT_VERSION (optional)
const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://127.0.0.1:4318'
const SERVER = process.env.EXPECT_SERVICE ?? 'vercel-otel-test'
const BROWSER = `${SERVER}-browser`

async function api(path) {
  const res = await fetch(`${COLLECTOR}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}
const traces = (params) => api(`/api/traces?${new URLSearchParams({ limit: '500', ...params })}`)
const spansOf = async (traceId) => (await api(`/api/traces/${traceId}`)).spans

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })

function tree(spans) {
  const byId = new Map(spans.map((s) => [s.spanId, s]))
  const ancestors = (s) => {
    const chain = []
    for (let p = byId.get(s.parentSpanId); p; p = byId.get(p.parentSpanId)) chain.push(p.name)
    return chain
  }
  return { byId, ancestors }
}

// services
const services = await api('/api/services')
const server = services.find((s) => s.name === SERVER)
check('services: server and browser services registered', server && services.some((s) => s.name === BROWSER), services.map((s) => s.name).join(', '))
if (process.env.EXPECT_VERSION) {
  check(`services: ${SERVER} has version ${process.env.EXPECT_VERSION}`, server?.versions.includes(process.env.EXPECT_VERSION), `versions: ${server?.versions}`)
}

// server render
const [pageTrace] = await traces({ operation: 'render ObservePage', service: SERVER })
const pageSpans = pageTrace ? await spansOf(pageTrace.traceId) : []
const page = pageSpans.find((s) => s.name === 'render ObservePage')
const load = pageSpans.find((s) => s.name === 'loadData')
const pageTree = tree(pageSpans)
check('server: render ObservePage is under render route /observe', page && pageTree.ancestors(page).includes('render route (app) /observe'), page && pageTree.ancestors(page).join(' < '))
check('server: loadData is a child of render ObservePage (~30ms)', load && pageTree.byId.get(load.parentSpanId)?.name === 'render ObservePage' && load.durationMs >= 25, load && `${load.durationMs}ms`)
check('server: code attributes', page?.attributes['code.filepath'] === 'app/observe/page.tsx' && page?.attributes['observe.kind'] === 'component')
check('server: trace root is GET /observe', pageTrace?.rootName === 'GET /observe', pageTrace?.rootName)

// server action: one trace from the browser fetch down to our span
const [actionTrace] = await traces({ operation: 'increment' })
const actionSpans = actionTrace ? await spansOf(actionTrace.traceId) : []
const increment = actionSpans.find((s) => s.name === 'increment')
check('action: increment is inside POST /observe', increment && tree(actionSpans).ancestors(increment).includes('POST /observe'))
check('action: browser fetch is the root of the same trace', actionTrace?.rootService === BROWSER && actionTrace?.services.includes(SERVER), actionTrace && `${actionTrace.rootService}: ${actionTrace.rootName}`)

// browser
const browserSpans = (await Promise.all((await traces({ service: BROWSER })).map((t) => spansOf(t.traceId)))).flat().filter((s) => s.service === BROWSER)
const counterRenders = browserSpans
  .filter((s) => s.name === 'react.renders')
  .reduce((n, s) => n + (s.attributes['react.render.Counter.count'] ?? 0), 0)
check('browser: documentLoad arrived via the /__observe proxy', browserSpans.some((s) => s.name === 'documentLoad'))
check('browser: Counter renders aggregated (hydration + 2 clicks)', counterRenders >= 3, `Counter.count total = ${counterRenders}`)
check('browser: exporter requests are not traced', !browserSpans.some((s) => String(s.attributes['http.url'] ?? s.attributes['url.full'] ?? '').includes('/__observe/')))

// aggregates for agents
const [stats] = await api(`/api/operations?${new URLSearchParams({ service: SERVER, operation: 'loadData' })}`)
check('operations: loadData stats with percentiles', stats?.count >= 1 && stats.p95Ms >= 25, stats && `count=${stats.count} p50=${stats.p50Ms} p95=${stats.p95Ms}`)

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${checks.length} checks passed`)
process.exit(failed ? 1 : 0)
