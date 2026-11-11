import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunCapture, PerformanceReports, startCollector, type PerformanceReport } from '../src/collector/index.js'
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
  const report: PerformanceReport = { schema: 'observe.performance-report/v1', id: 'comparison', title: 'A generic external comparison', endpoint: 'handler start → commit', analysisUnit: 'run-median', algorithm: 'nearest-rank/v1', protocol: { name: 'protocol.json', sha256: protocolHash }, runs: [{ runId: 'baseline', variant: 'baseline', mode: 'diagnostic', block: 0, warmup: 1, samples: { count: 2, p50Ms: 0, p75Ms: 1, p95Ms: 1, minMs: 0, maxMs: 1 }, manifestSha256: sha(await readFile(join(capture.directory, 'baseline', 'finalized.json'))), sampleArtifact: { name: 'baseline.json', sha256: sampleHash } }], groups: [{ variant: 'baseline', mode: 'diagnostic', runIds: ['baseline'], medianOfRunMediansMs: 0, minRunMedianMs: 0, maxRunMedianMs: 0 }], limitations: ['Analysis supplied by external harness; no CI.'] }
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
