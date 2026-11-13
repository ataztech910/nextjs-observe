import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunCapture, PerformanceReports, startCollector, type PerformanceComparisonReport } from '../src/collector/index.js'
import { performanceTrace } from './fixtures/performance-trace.js'
import { performanceNumber } from '../ui/src/lib/performance.js'
import { parseCliArgs } from '../src/cli.js'
const sha = (body: string | Buffer) => createHash('sha256').update(body).digest('hex')
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'observe-reports-test-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'reports')
  await mkdir(join(directory, 'artifacts'), { recursive: true })
  const capture = new RunCapture(join(root, 'captures'))
  const protocol = Buffer.from('{"protocol":"fixture"}')
  const samples = Buffer.from('{"source":"external-harness","samples":[0,1]}')
  const protocolHash = sha(protocol), sampleHash = sha(samples)
  await writeFile(join(directory, 'artifacts', protocolHash), protocol)
  await writeFile(join(directory, 'artifacts', sampleHash), samples)
  await capture.create('baseline', { experiment: 'C', variant: 'baseline', platform: 'react-web', labels: { mode: 'diagnostic', 'protocol.sha256': protocolHash } })
  await capture.ingest('baseline', 'traces', 'json', Buffer.from(JSON.stringify(performanceTrace().json)))
  await capture.finalize('baseline')
  const report: PerformanceComparisonReport = { schema: 'observe.performance-report/v1', id: 'comparison', title: 'A generic external comparison', endpoint: 'handler start → commit', analysisUnit: 'run-median', algorithm: 'nearest-rank/v1', protocol: { name: 'protocol.json', sha256: protocolHash }, runs: [{ runId: 'baseline', variant: 'baseline', mode: 'diagnostic', block: 0, warmup: 1, samples: { count: 2, p50Ms: 0, p75Ms: 1, p95Ms: 1, minMs: 0, maxMs: 1 }, manifestSha256: sha(await readFile(join(capture.directory, 'baseline', 'finalized.json'))), sampleArtifact: { name: 'baseline.json', sha256: sampleHash } }], groups: [{ variant: 'baseline', mode: 'diagnostic', runIds: ['baseline'], medianOfRunMediansMs: 0, minRunMedianMs: 0, maxRunMedianMs: 0 }], limitations: ['Analysis supplied by external harness; no CI.'] }
  const file = join(directory, 'comparison.json')
  await writeFile(file, JSON.stringify(report))
  return { root, directory, capture, report, file, store: new PerformanceReports(directory, capture), protocolHash, sampleHash }
}
describe('read-only external performance reports', () => {
  it('reads generic reports, verifies artifacts/capture associations, and retains real zeros', async () => {
    const f = await fixture()
    expect(await f.store.get('comparison')).toEqual(f.report)
    expect(await f.store.list()).toEqual({ reports: [{ id: 'comparison', title: f.report.title, endpoint: f.report.endpoint, runCount: 1 }], errors: [] })
    expect(performanceNumber(0)).toBe('0.000')
    expect(performanceNumber(null)).toBe('—')
    expect(performanceNumber(undefined)).toBe('—')
    expect(performanceNumber(NaN)).toBe('—')
  })
  it.each(['sample', 'protocol', 'manifest', 'otlp'])('fails on modified %s data rather than displaying stale analysis', async (target) => {
    const f = await fixture()
    if (target === 'sample') await writeFile(join(f.directory, 'artifacts', f.sampleHash), '{}')
    else if (target === 'protocol') await writeFile(join(f.directory, 'artifacts', f.protocolHash), '{}')
    else if (target === 'manifest') await writeFile(join(f.capture.directory, 'baseline', 'finalized.json'), '{}')
    else {
      const { manifest } = await f.capture.read('baseline')
      await writeFile(join(f.capture.directory, 'baseline', manifest.records[0].file), '{}')
    }
    await expect(f.store.get('comparison')).rejects.toThrow(target === 'manifest' ? /manifest hash mismatch/ : /hash mismatch|inventory|manifest/)
    const listed = await f.store.list()
    expect(listed.reports).toHaveLength(0)
    expect(listed.errors).toHaveLength(1)
  })
  it('rejects altered variant/mode/protocol attribution, even with valid artifact hashes', async () => {
    const f = await fixture()
    for (const changed of ['variant', 'mode', 'protocol']) {
      const r = structuredClone(f.report)
      if (changed === 'variant') { r.runs[0].variant = 'optimized'; r.groups[0].variant = 'optimized' }
      else if (changed === 'mode') { r.runs[0].mode = 'disabled'; r.groups[0].mode = 'disabled' }
      else r.protocol = r.runs[0].sampleArtifact
      await writeFile(f.file, JSON.stringify(r))
      await expect(f.store.get('comparison')).rejects.toThrow(/association mismatch/)
    }
  })
  it('validates schema, unique membership, ordered quantiles and explicit empty values', async () => {
    const f = await fixture()
    for (const mutate of [
      (r: any) => { r.schema = 'unknown/v2' },
      (r: any) => { r.runs.push(r.runs[0]) },
      (r: any) => { r.groups[0].runIds = ['missing'] },
      (r: any) => { r.runs[0].samples.p50Ms = 2 },
      (r: any) => { r.runs[0].samples.count = 0 },
      (r: any) => { r.groups[0].medianOfRunMediansMs = 3 },
    ]) {
      const report = structuredClone(f.report); mutate(report)
      await writeFile(f.file, JSON.stringify(report))
      await expect(f.store.get('comparison')).rejects.toThrow(/schema/)
    }
    await expect(f.store.get('../escape')).rejects.toMatchObject({ status: 400 })
    await expect(f.store.get('missing')).rejects.toMatchObject({ status: 404 })
    expect(await new PerformanceReports(join(f.root, 'absent'), f.capture).list()).toEqual({ reports: [], errors: [] })
  })
  it('bounds actual report file bytes and reports malformed data explicitly', async () => {
    const f = await fixture()
    await writeFile(f.file, Buffer.alloc(8 * 1024 * 1024 + 1, 32))
    await expect(f.store.get('comparison')).rejects.toMatchObject({ status: 413 })
    await writeFile(f.file, '{')
    await expect(f.store.get('comparison')).rejects.toMatchObject({ status: 400 })
  })
  it('uses UI Basic auth for reports/features; disabled report API has explicit capability', async () => {
    const f = await fixture()
    const server = await startCollector({ port: 0, capture: f.capture, performanceReports: f.store, uiPassword: 'viewer', uiDir: false })
    cleanup.push(() => server.close())
    for (const path of ['/api/performance/features', '/api/performance/reports', '/api/performance/reports/comparison']) expect((await fetch(server.url + path)).status).toBe(401)
    const headers = { authorization: `Basic ${Buffer.from('u:viewer').toString('base64')}` }
    expect(await (await fetch(server.url + '/api/performance/features', { headers })).json()).toEqual({ runs: true, reports: true })
    expect(await (await fetch(server.url + '/api/performance/reports/comparison', { headers })).json()).toEqual(f.report)
    const disabled = await startCollector({ port: 0, uiDir: false })
    cleanup.push(() => disabled.close())
    expect(await (await fetch(disabled.url + '/api/performance/features')).json()).toEqual({ runs: false, reports: false })
    expect((await fetch(disabled.url + '/api/performance/reports')).status).toBe(503)
    expect(parseCliArgs(['collector', '--capture-dir', 'captures', '--performance-report-dir', 'reports'], {}, '/tmp/work')).toMatchObject({ captureDir: '/tmp/work/captures', performanceReportDir: '/tmp/work/reports' })
  })
})

describe('runner-neutral scenario reports', () => {
  async function scenario() {
    const f = await fixture()
    const report = {
      schema: 'observe.scenario-report/v1', id: 'scenario', title: 'Controlled UI scenario', endpoint: 'handler to commit', runner: 'playwright', protocol: f.report.protocol,
      limitations: ['Functional smoke; no performance threshold or hitch measurement.'],
      runs: [{ runId: 'baseline', variant: 'baseline', mode: 'diagnostic', manifestFile: 'finalized.json', manifestSha256: f.report.runs[0].manifestSha256,
        status: 'passed', checks: [{ name: 'checksum', status: 'passed', details: 'Expected result observed' }],
        measurements: [{ name: 'duration', value: 0, unit: 'ms', source: 'app performance.now', unavailableReason: null }, { name: 'paint', value: null, unit: 'ms', source: 'browser presentation', unavailableReason: 'No presentation sensor attached' }], artifacts: [f.report.runs[0].sampleArtifact] }],
    }
    const file = join(f.directory, 'scenario.json')
    await writeFile(file, JSON.stringify(report))
    return { ...f, report, file }
  }
  it('reads both runners through the authenticated report API, retaining zero and unavailable', async () => {
    const f = await scenario()
    const server = await startCollector({ port: 0, capture: f.capture, performanceReports: f.store, uiPassword: 'viewer', uiDir: false })
    cleanup.push(() => server.close())
    const url = server.url + '/api/performance/reports/scenario'
    expect((await fetch(url)).status).toBe(401)
    for (const runner of ['playwright', 'maestro']) {
      f.report.runner = runner
      await writeFile(f.file, JSON.stringify(f.report))
      const response = await fetch(url, { headers: { authorization: `Basic ${Buffer.from('u:viewer').toString('base64')}` } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(f.report)
    }
    expect((await f.store.list()).reports.map((r) => r.id)).toEqual(['comparison', 'scenario'])
  })
  it.each(['artifact', 'manifest', 'protocol', 'variant', 'mode'])('rejects tampered scenario %s', async (target) => {
    const f = await scenario()
    if (target === 'artifact') await writeFile(join(f.directory, 'artifacts', f.sampleHash), '{}')
    else if (target === 'manifest') f.report.runs[0].manifestSha256 = '0'.repeat(64)
    else if (target === 'protocol') f.report.protocol = f.report.runs[0].artifacts[0]
    else if (target === 'variant') f.report.runs[0].variant = 'foreign'
    else f.report.runs[0].mode = 'foreign'
    await writeFile(f.file, JSON.stringify(f.report))
    await expect(f.store.get('scenario')).rejects.toThrow(/mismatch/)
  })
  it('rejects contradictory status, missing reasons, duplicate items and unknown schema', async () => {
    const f = await scenario()
    for (const mutate of [
      (r: any) => { r.runs[0].checks[0].status = 'failed' },
      (r: any) => { r.runs[0].measurements[1].unavailableReason = null },
      (r: any) => { r.runs[0].measurements[0].unavailableReason = 'unavailable' },
      (r: any) => { r.runs[0].measurements[0].value = null },
      (r: any) => { r.runs[0].checks.push(r.runs[0].checks[0]) },
      (r: any) => { r.runs.push(r.runs[0]) },
      (r: any) => { r.runs[0].manifestFile = '../run.json' },
      (r: any) => { r.schema = 'observe.scenario-report/v2' },
    ]) {
      const changed = structuredClone(f.report); mutate(changed)
      await writeFile(f.file, JSON.stringify(changed))
      await expect(f.store.get('scenario')).rejects.toThrow(/schema/)
    }
  })
  it('shows a failed or incomplete scenario on a draft capture but never reports it as passed', async () => {
    const f = await scenario()
    await f.capture.create('draft', { experiment: 'C', variant: 'baseline', platform: 'react-web', labels: { mode: 'diagnostic', 'protocol.sha256': f.protocolHash } })
    const run = f.report.runs[0]
    run.runId = 'draft'; run.manifestFile = 'run.json'
    run.manifestSha256 = sha(await readFile(join(f.capture.directory, 'draft', 'run.json')))
    for (const state of ['incomplete', 'failed']) {
      run.status = state; run.checks[0].status = state
      await writeFile(f.file, JSON.stringify(f.report))
      expect(await f.store.get('scenario')).toEqual(f.report)
    }
    run.status = 'passed'; run.checks[0].status = 'passed'
    await writeFile(f.file, JSON.stringify(f.report))
    await expect(f.store.get('scenario')).rejects.toThrow(/schema/)
    await f.capture.finalize('draft')
    run.status = 'failed'; run.checks[0].status = 'failed'
    await writeFile(f.file, JSON.stringify(f.report))
    await expect(f.store.get('scenario')).rejects.toThrow(/association mismatch/)
  })
})
