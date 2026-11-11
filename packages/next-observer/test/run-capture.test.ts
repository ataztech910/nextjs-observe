import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunCapture, replayRun, hashArtifact, CaptureError } from '../src/collector/index.js'
import { performanceTrace } from './fixtures/performance-trace.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'
import { matchesPredicates, validatePredicates } from '../src/collector/run-predicates.js'

const temporary: string[] = []
async function setup(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'observe-capture-test-'))
  temporary.push(directory)
  return { directory, capture: new RunCapture(directory, options) }
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const metadata = { experiment: 'C', variant: 'degraded', platform: 'web', sources: [{ name: 'profiler', available: true }], clocks: [{ source: 'performance', uncertaintyNs: '50000' }] }
const trace = () => Buffer.from(JSON.stringify(performanceTrace().json))
const metric = () => Buffer.from(JSON.stringify(performanceMetrics().json))

describe('versioned run capture', () => {
  it('replays complete raw JSON/protobuf including unknown fields, with stable deduplicated counts after restart/export', async () => {
    const { capture, directory } = await setup()
    const artifactPath = join(directory, 'profile.json')
    await writeFile(artifactPath, '{"external":true}')
    const artifact = await hashArtifact(artifactPath, 'application/json')
    await capture.create('run-1', { ...metadata, artifacts: [artifact] })
    const source = { ...performanceTrace().json, futureField: { data: 'preserved' } }
    const json = Buffer.from(JSON.stringify(source))
    const protobuf = Buffer.concat([performanceTrace().protobuf, Buffer.from([0xa0, 0x06, 7])])
    await capture.ingest('run-1', 'traces', 'json', json)
    await capture.ingest('run-1', 'traces', 'protobuf', protobuf)
    await capture.ingest('run-1', 'metrics', 'json', metric())
    await capture.ingest('run-1', 'metrics', 'protobuf', performanceMetrics().protobuf)
    await capture.ingest('run-1', 'traces', 'json', json)
    const finalized = await capture.finalize('run-1')
    expect(finalized).toMatchObject({ schema: 'next-observe/run/v1', status: 'finalized', incompleteReasons: [], counts: { requests: 4, spans: 1, metricPoints: 4 }, metadata: { artifacts: [artifact] } })
    expect(await capture.finalize('run-1')).toEqual(finalized)
    const raw = finalized.records.find((r) => r.signal === 'traces' && r.format === 'json')!
    expect(await readFile(join(directory, 'run-1', raw.file))).toEqual(json)
    expect(await readFile(join(directory, 'run-1', finalized.records[1].file))).toEqual(protobuf)
    const restarted = new RunCapture(directory)
    expect((await restarted.read('run-1')).manifest).toEqual(finalized)
    const exportPath = join(directory, 'exported')
    await restarted.exportRun('run-1', exportPath)
    for (let i = 0; i < 2; i++) {
      const replay = await replayRun(exportPath)
      expect(replay.manifest).toEqual(finalized)
      expect(await replay.storage.count()).toBe(1)
      expect((await replay.metricStorage.queryMetrics()).total).toBe(4)
      const spans = await replay.storage.querySpans({})
      expect(spans[0].startTimeUnixNano).toBe('1800000000123456789')
      expect((await replay.storage.getOperationStats({}))[0].count).toBe(1)
    }
    await expect(restarted.exportRun('run-1', exportPath)).rejects.toMatchObject({ status: 409 })
    // Exact retry succeeds after finalization; a new observation cannot alter the frozen run.
    await capture.ingest('run-1', 'traces', 'json', json)
    await expect(capture.ingest('run-1', 'traces', 'json', trace())).rejects.toMatchObject({ status: 409 })
  })

  it('keeps two runs with identical IDs/metric stream intervals independent', async () => {
    const { capture } = await setup()
    await capture.create('A', metadata)
    await capture.create('B', { ...metadata, variant: 'baseline' })
    await capture.ingest('A', 'traces', 'json', trace())
    await capture.ingest('B', 'traces', 'json', trace())
    await capture.ingest('A', 'metrics', 'json', metric())
    const changed = performanceMetrics().json
    changed.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt = '99'
    await capture.ingest('B', 'metrics', 'json', Buffer.from(JSON.stringify(changed)))
    const a = await capture.read('A')
    const b = await capture.read('B')
    expect(await a.storage.count()).toBe(1)
    expect(await b.storage.count()).toBe(1)
    expect((await a.metricStorage.queryMetrics({ name: 'calls' })).points[0].point).toMatchObject({ asInt: '7' })
    expect((await b.metricStorage.queryMetrics({ name: 'calls' })).points[0].point).toMatchObject({ asInt: '99' })
    expect((await capture.list()).map((r) => r.runId)).toEqual(['A', 'B'])
    expect((await capture.list())[0]).not.toHaveProperty('records')
  })

  it('serializes concurrent writers/retries/finalization and detaches caller buffers before waiting', async () => {
    const { capture } = await setup()
    await capture.create('C', metadata)
    const body = trace()
    const writes = Array.from({ length: 12 }, () => capture.ingest('C', 'traces', 'json', body))
    body.fill(0)
    const metrics = capture.ingest('C', 'metrics', 'json', metric())
    const final = capture.finalize('C')
    await Promise.all([...writes, metrics])
    expect((await final).counts).toMatchObject({ requests: 2, spans: 1, metricPoints: 4 })
  })

  it('rejects a second process writer lock and exposes read-only crash recovery as incomplete', async () => {
    const { capture, directory } = await setup()
    await capture.create('crash', { ...metadata, incompleteReasons: ['producer-reported-drops'] })
    await capture.ingest('crash', 'traces', 'json', trace())
    await writeFile(join(directory, 'crash', 'ignored.pending-crash'), 'unfinished file')
    await writeFile(join(directory, 'crash', '.write-lock'), 'stale-process')
    await expect(capture.ingest('crash', 'traces', 'json', trace())).rejects.toMatchObject({ status: 503 })
    const recovered = await replayRun(join(directory, 'crash'))
    expect(recovered.manifest).toMatchObject({ status: 'incomplete', incompleteReasons: ['run-not-finalized', 'producer-reported-drops'], counts: { spans: 1 } })
    await rm(join(directory, 'crash', '.write-lock'))
    expect((await capture.finalize('crash')).incompleteReasons).toEqual(['producer-reported-drops'])
  })

  it('rejects malformed batches and metric conflicts atomically before publishing a file', async () => {
    const { capture, directory } = await setup()
    await capture.create('bad', metadata)
    await capture.ingest('bad', 'metrics', 'json', metric())
    const before = await readdir(join(directory, 'bad'))
    const conflicting = performanceMetrics().json
    conflicting.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt = '999'
    await expect(capture.ingest('bad', 'metrics', 'json', Buffer.from(JSON.stringify(conflicting)))).rejects.toThrow('conflicting')
    await expect(capture.ingest('bad', 'traces', 'json', Buffer.from('{'))).rejects.toThrow()
    expect(await readdir(join(directory, 'bad'))).toEqual(before)
    expect((await capture.read('bad')).manifest.counts).toMatchObject({ requests: 1, metricPoints: 4 })
    // Failed operations do not poison the per-run queue.
    await capture.ingest('bad', 'traces', 'json', trace())
    expect((await capture.read('bad')).manifest.counts.spans).toBe(1)
  })

  it.each([
    { maxRequestBytes: 10 }, { maxBytes: 10 }, { maxObservations: 1 },
  ])('enforces capture and replay budgets %j', async (options) => {
    const { capture, directory } = await setup(options)
    await capture.create('limited', metadata)
    await expect(capture.ingest('limited', 'metrics', 'json', metric())).rejects.toMatchObject({ status: 413 })
    expect((await readdir(join(directory, 'limited')))).toEqual(['run.json'])
    const unrestricted = new RunCapture(directory)
    await unrestricted.ingest('limited', 'metrics', 'json', metric())
    await expect(replayRun(join(directory, 'limited'), options)).rejects.toMatchObject({ status: 413 })
  })

  it('enforces request limits while allowing exact retries without consuming more budget', async () => {
    const { capture } = await setup({ maxRequests: 1 })
    await capture.create('limited', metadata)
    await capture.ingest('limited', 'traces', 'json', trace())
    await capture.ingest('limited', 'traces', 'json', trace())
    await expect(capture.ingest('limited', 'metrics', 'json', metric())).rejects.toMatchObject({ status: 413 })
    await expect(capture.exportRun('limited', '/tmp/unused-export')).rejects.toMatchObject({ status: 409 })
  })

  it('fails closed on unknown schema, modified bodies, missing records and changed final counts', async () => {
    for (const corruption of ['schema', 'hash', 'missing', 'counts']) {
      const { capture, directory } = await setup()
      await capture.create('run', metadata)
      await capture.ingest('run', 'traces', 'json', trace())
      const manifest = await capture.finalize('run')
      const path = join(directory, 'run')
      if (corruption === 'schema') {
        const draft = JSON.parse(await readFile(join(path, 'run.json'), 'utf8'))
        draft.schema = 'future/v2'
        await writeFile(join(path, 'run.json'), JSON.stringify(draft))
      } else if (corruption === 'hash') await writeFile(join(path, manifest.records[0].file), '{}')
      else if (corruption === 'missing') await rm(join(path, manifest.records[0].file))
      else { manifest.counts.spans = 9; await writeFile(join(path, 'finalized.json'), JSON.stringify(manifest)) }
      if (corruption === 'hash') await expect(replayRun(path)).rejects.toThrow('hash mismatch')
      else await expect(replayRun(path)).rejects.toBeInstanceOf(CaptureError)
    }
  })

  it('validates run IDs, metadata, duplicate creation and query pages', async () => {
    const { capture } = await setup()
    for (const id of ['..', '../other', 'a/b', '', '.hidden']) await expect(capture.create(id, metadata)).rejects.toMatchObject({ status: 400 })
    await expect(capture.create('invalid', { ...metadata, artifacts: [{ name: 'x', sha256: 'wrong', sizeBytes: 1 }] })).rejects.toMatchObject({ status: 400 })
    await capture.create('ok', metadata)
    await expect(capture.create('ok', metadata)).rejects.toMatchObject({ status: 409 })
    await expect(capture.read('missing')).rejects.toMatchObject({ status: 404 })
    for (const input of [{ limit: 0 }, { offset: -1 }, { limit: Infinity }, { offset: 0.5 }]) await expect(capture.query('ok', 'traces', input)).rejects.toMatchObject({ status: 400 })
    expect(await capture.query('ok', 'traces')).toMatchObject({ total: 0, nextOffset: null, observations: [] })
  })

  it('filters one observation at a time, distinguishes resource/span/point attributes, and pages the full dataset', async () => {
    const { capture } = await setup()
    await capture.create('filter', metadata)
    const payload = performanceTrace().json
    const scope = payload.resourceSpans![0].scopeSpans![0]
    const first = scope.spans![0]
    scope.spans!.push({ ...first, spanId: '9'.repeat(16), attributes: [{ key: 'experiment.variant', value: { stringValue: 'baseline' } }] })
    await capture.ingest('filter', 'traces', 'json', Buffer.from(JSON.stringify(payload)))
    await capture.ingest('filter', 'metrics', 'json', metric())
    const page = await capture.query('filter', 'traces', { limit: 1 })
    expect(page).toMatchObject({ total: 2, truncated: true, nextOffset: 1 })
    expect(await capture.query('filter', 'traces', { limit: 1, offset: 1 })).toMatchObject({ total: 2, nextOffset: null })
    expect((await capture.query('filter', 'traces', { where: [
      { target: 'observation', key: 'experiment.variant', value: { stringValue: 'baseline' } },
      { target: 'observation', key: 'observe.perf.phase', value: { stringValue: 'compute' } },
    ] })).total).toBe(0)
    expect((await capture.query('filter', 'traces', { where: [
      { target: 'resource', key: 'service.name', value: { stringValue: 'performance-fixture' } },
      { target: 'observation', key: 'observe.perf.phase', value: { stringValue: 'compute' } },
    ] })).total).toBe(1)
    expect((await capture.query('filter', 'metrics', { where: [{ target: 'resource', key: 'service.name', value: { stringValue: 'metric-fixture' } }] })).total).toBe(4)
    expect((await capture.query('filter', 'metrics', { where: [{ target: 'observation', key: 'service.name', value: { stringValue: 'metric-fixture' } }] })).total).toBe(0)
  })
})

describe('typed allowlisted run predicates', () => {
  it('keeps int64/string/double/boolean types distinct without coercion', () => {
    const predicates = validatePredicates([{ target: 'observation', key: 'experiment.id', value: { intValue: '9223372036854775807' } }])
    expect(matchesPredicates([], [{ key: 'experiment.id', value: { intValue: '9223372036854775807' } }], predicates)).toBe(true)
    expect(matchesPredicates([], [{ key: 'experiment.id', value: { stringValue: '9223372036854775807' } }], predicates)).toBe(false)
    expect(matchesPredicates([], [], predicates)).toBe(false)
  })
  it.each([null, {}, [null], [{ target: 'span', key: 'service.name', value: { stringValue: 's' } }], [{ target: 'resource', key: 'secret', value: { stringValue: 's' } }], [{ target: 'resource', key: 'service.name', value: { intValue: '9223372036854775808' } }], [{ target: 'resource', key: 'service.name', value: { arrayValue: { values: [] } } }]])('rejects invalid/unsupported predicates %j', (input) => {
    expect(() => validatePredicates(input)).toThrow(CaptureError)
  })
})
