// node e2e/performance-runs.mjs <extracted-package> <capture-directory> <report-directory> [--serve]
// Exercises the packed receiver/backend/UI on real archived runs and the external analysis contract.
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [packagePath, capturePath, reportsPath] = process.argv.slice(2)
if (!packagePath || !capturePath || !reportsPath) throw new Error('Pass package, capture and report directories')
const { startCollector, RunCapture, PerformanceReports } = await import(pathToFileURL(join(resolve(packagePath), 'dist/collector/index.js')))
const capture = new RunCapture(capturePath)
const collector = await startCollector({ port: 0, capture, performanceReports: new PerformanceReports(reportsPath, capture) })
let serve = false
try {
  const get = async (path) => { const response = await fetch(collector.url + path); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
  assert.deepEqual(await get('/api/performance/features'), { runs: true, reports: true })
  const reports = await get('/api/performance/reports')
  assert.equal(reports.errors.length, 0)
  assert.ok(reports.reports.length > 0)
  const id = reports.reports[0].id
  const report = await get(`/api/performance/reports/${id}`)
  const runs = await get('/api/performance/runs')
  for (const row of report.runs) assert.ok(runs.runs.some((run) => run.runId === row.runId))
  const disabled = report.runs.find((r) => r.mode === 'disabled')
  if (disabled) {
    assert.ok(disabled.samples.count > 0)
    assert.equal((await get(`/api/performance/runs/${disabled.runId}/spans`)).total, 0)
    assert.equal((await get(`/api/performance/runs/${disabled.runId}/metrics`)).total, 0)
    assert.equal((await get(`/api/performance/runs/${disabled.runId}/traces`)).total, 0)
  }
  const selected = report.runs.find((r) => r.mode === 'diagnostic')
  if (selected) {
    assert.equal((await get(`/api/performance/runs/${selected.runId}/spans`)).total, (selected.warmup + selected.samples.count) * 2)
    assert.ok((await get(`/api/performance/runs/${selected.runId}/metrics`)).total > 0)
    const index = await get(`/api/performance/runs/${selected.runId}/traces`)
    assert.equal(index.total, selected.warmup + selected.samples.count)
    const trace = await get(`/api/performance/runs/${selected.runId}/traces/${index.traces[0].traceId}`)
    assert.equal(trace.totalSpans, 2)
    assert.equal(trace.truncated, false)
    assert.equal(trace.spans.filter((span) => span.parentSpanId).length, 1)
    assert.ok(trace.spans.some((span) => span.events.some((event) => /commit/.test(event.name))))
    assert.ok(trace.spans.every((span) => span.startTimeUnixNano && span.endTimeUnixNano))
  }
  const ui = await fetch(collector.url + '/performance')
  assert.equal(ui.status, 200)
  assert.match(await ui.text(), /<div id="root">/)
  console.log(JSON.stringify({ status: 'passed', url: collector.url, page: `${collector.url}/performance?report=${id}`, runs: report.runs.length, groups: report.groups.length }))
  serve = process.argv.includes('--serve')
} finally { if (!serve) await collector.close() }
if (serve) { const stop = () => collector.close().then(() => process.exit(0)); process.once('SIGINT', stop); process.once('SIGTERM', stop) }
