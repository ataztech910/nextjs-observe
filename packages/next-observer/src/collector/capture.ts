// Local OTLP archives. Instrumentation stays in Observe/SDKs; this module only receives and preserves data.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { summarizeRunTraces } from './run-traces.js'
import type { RunTraceDetail } from './run-types.js'
import { decodeOtlpJson } from './decode.js'
import { decodeOtlpMetrics } from './metric-decode.js'
import { MemoryStorage } from './memory-storage.js'
import { MemoryMetricStorage } from './metric-storage.js'
import { protobufToOtlpJson } from './protobuf.js'
import { protobufToOtlpMetrics } from './metric-protobuf.js'
import { CaptureError, RUN_SCHEMA, draftSchema, manifestSchema, parseMetadata, runId, type RunManifest, type RunMetadata } from './run-manifest.js'
import { matchesPredicates, validatePredicates } from './run-predicates.js'
import type { MetricObservation } from './metric-types.js'
import type { NormalizedSpan } from './types.js'

export interface CaptureOptions {
  /** Per run. Defaults: 64 MiB of uncompressed OTLP, 10_000 requests, 200_000 decoded observations (including retries). */
  maxBytes?: number
  maxRequests?: number
  maxObservations?: number
  /** Default 10 MiB; both capture and replay enforce this bound. */
  maxRequestBytes?: number
}
interface Limits { maxBytes: number; maxRequests: number; maxObservations: number; maxRequestBytes: number }
export interface ReplayedRun { manifest: RunManifest; storage: MemoryStorage; metricStorage: MemoryMetricStorage }
const DEDUP = 'traceId/spanId:first-wins;metric-stream/interval:identical-only' as const
const sha256 = (body: Uint8Array) => createHash('sha256').update(body).digest('hex')
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
function limits(options: CaptureOptions): Limits {
  const result = { maxBytes: options.maxBytes ?? 64 * 1024 * 1024, maxRequests: options.maxRequests ?? 10_000, maxObservations: options.maxObservations ?? 200_000, maxRequestBytes: options.maxRequestBytes ?? 10 * 1024 * 1024 }
  if (Object.values(result).some((v) => !Number.isSafeInteger(v) || v < 1)) throw new CaptureError(400, 'capture limits must be positive safe integers')
  return result
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
async function atomicWrite(path: string, body: string | Buffer): Promise<void> {
  const temporary = `${path}.pending-${randomUUID()}`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } finally { await rm(temporary, { force: true }) }
}
async function boundedRead(path: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  // Bound the actual bytes read, including a file that grows after a stat check.
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new CaptureError(413, 'archive file exceeds byte budget')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, bytes)
}

function parseJson(body: Buffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) }
  catch { throw new CaptureError(400, 'invalid archive/OTLP JSON') }
}
function decode(signal: 'traces' | 'metrics', format: 'json' | 'protobuf', body: Buffer) {
  const payload = format === 'json' ? parseJson(body) : signal === 'traces' ? protobufToOtlpJson(body) : protobufToOtlpMetrics(body)
  return signal === 'traces' ? { spans: decodeOtlpJson(payload), points: [] } : { spans: [], points: decodeOtlpMetrics(payload) }
}
async function add(state: ReplayedRun, signal: 'traces' | 'metrics', format: 'json' | 'protobuf', body: Buffer): Promise<number> {
  const { spans, points } = decode(signal, format, body)
  if (signal === 'traces') await state.storage.insertSpansOnce(spans)
  else await state.metricStorage.insertMetrics(points)
  return spans.length + points.length
}
async function updateCounts(state: ReplayedRun): Promise<void> {
  state.manifest.counts = {
    requests: state.manifest.records.length,
    bytes: state.manifest.records.reduce((n, r) => n + r.bytes, 0),
    spans: await state.storage.count(), metricPoints: (await state.metricStorage.queryMetrics({ limit: 1 })).total,
  }
}

/** Replay into fresh, isolated stores: repeated replay never adds points to another run or the live dataset. */
export async function replayRun(directory: string, options: CaptureOptions = {}): Promise<ReplayedRun> {
  const bound = limits(options)
  let draft: ReturnType<typeof draftSchema.parse>
  try {
    draft = draftSchema.parse(parseJson(await boundedRead(join(directory, 'run.json'), 64 * 1024)))
    parseMetadata(draft.metadata)
  }
  catch (e) {
    if (isMissing(e)) throw new CaptureError(404, 'run not found')
    if (e instanceof CaptureError) throw e
    throw new CaptureError(400, 'unknown or invalid archive schema')
  }
  let finalized: RunManifest | undefined
  try {
    const result = manifestSchema.safeParse(parseJson(await boundedRead(join(directory, 'finalized.json'), 8 * 1024 * 1024)))
    if (!result.success || result.data.status !== 'finalized' || !result.data.finalizedAt) throw new CaptureError(400, 'unknown or invalid finalized manifest')
    finalized = result.data
    if (finalized.runId !== draft.runId || finalized.schema !== draft.schema || JSON.stringify(finalized.metadata) !== JSON.stringify(draft.metadata) || finalized.createdAt !== draft.createdAt) throw new CaptureError(400, 'manifest does not match run metadata')
  } catch (e) { if (!isMissing(e)) throw e }
  const names = (await readdir(directory)).filter((name) => !name.includes('.pending-') && name !== '.write-lock' && name !== 'run.json' && name !== 'finalized.json').sort()
  if (names.length > bound.maxRequests) throw new CaptureError(413, 'archive exceeds request budget')
  const state: ReplayedRun = {
    manifest: { ...draft, status: 'incomplete', finalizedAt: null, incompleteReasons: ['run-not-finalized', ...draft.metadata.incompleteReasons], records: [], counts: { requests: 0, bytes: 0, spans: 0, metricPoints: 0 }, deduplication: DEDUP, coverage: 'received-requests-only' },
    storage: new MemoryStorage({ maxSpans: bound.maxObservations }), metricStorage: new MemoryMetricStorage(bound.maxObservations),
  }
  let bytes = 0
  let observations = 0
  for (const [index, name] of names.entries()) {
    const match = /^(\d{8})-(traces|metrics)-(json|protobuf)-([a-f0-9]{64})\.otlp$/.exec(name)
    if (!match || Number(match[1]) !== index) throw new CaptureError(400, 'invalid archive sequence or unexpected file')
    const signal = match[2] as 'traces' | 'metrics'
    const format = match[3] as 'json' | 'protobuf'
    const body = await boundedRead(join(directory, name), bound.maxRequestBytes)
    bytes += body.length
    if (bytes > bound.maxBytes) throw new CaptureError(413, 'archive exceeds byte budget')
    if (sha256(body) !== match[4]) throw new CaptureError(400, 'archive request hash mismatch')
    const count = await add(state, signal, format, body)
    observations += count
    if (observations > bound.maxObservations) throw new CaptureError(413, 'archive exceeds observation budget')
    state.manifest.records.push({ file: name, signal, format, sha256: match[4], bytes: body.length, observations: count })
  }
  await updateCounts(state)
  if (finalized) {
    if (JSON.stringify(finalized.records) !== JSON.stringify(state.manifest.records) || JSON.stringify(finalized.counts) !== JSON.stringify(state.manifest.counts) || JSON.stringify(finalized.incompleteReasons) !== JSON.stringify(draft.metadata.incompleteReasons)) throw new CaptureError(400, 'finalized archive inventory/counts mismatch')
    state.manifest = finalized
  }
  return state
}

export class RunCapture {
  readonly directory: string
  private readonly bound: Limits
  private readonly queues = new Map<string, Promise<unknown>>()
  constructor(directory: string, options: CaptureOptions = {}) { this.directory = resolve(directory); this.bound = limits(options) }
  private path(id: string) { return join(this.directory, runId(id)) }
  private async replay(path: string, id: string): Promise<ReplayedRun> {
    const state = await replayRun(path, this.bound)
    if (state.manifest.runId !== id) throw new CaptureError(400, 'run ID does not match archive metadata (IDs are case-sensitive)')
    return state
  }
  private async exclusive<T>(id: string, operation: (path: string) => Promise<T>): Promise<T> {
    const path = this.path(id)
    const previous = this.queues.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      // Also reject a concurrent writer in another process. A crash may leave this advisory lock;
      // read-only replay still works; inspect/remove the stale lock before resuming writes.
      let lock
      try { lock = await open(join(path, '.write-lock'), 'wx', 0o600) }
      catch (e) {
        if (isMissing(e)) throw new CaptureError(404, 'run not found')
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new CaptureError(503, 'run is locked by another writer; inspect a stale .write-lock after a crash')
        throw e
      }
      try { await lock.writeFile(String(process.pid)); return await operation(path) }
      finally { await lock.close(); await unlink(join(path, '.write-lock')) }
    })
    this.queues.set(id, task)
    try { return await task } finally { if (this.queues.get(id) === task) this.queues.delete(id) }
  }
  async create(id: string, input: RunMetadata): Promise<RunManifest> {
    const path = this.path(id)
    const metadata = parseMetadata(input)
    const draft = JSON.stringify({ schema: RUN_SCHEMA, runId: id, createdAt: new Date().toISOString(), metadata })
    if (Buffer.byteLength(draft) > 64 * 1024) throw new CaptureError(413, 'run metadata exceeds 64 KiB')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.creating-${randomUUID()}`)
    await mkdir(temporary, { mode: 0o700 })
    try {
      await atomicWrite(join(temporary, 'run.json'), draft)
      try { await rename(temporary, path) }
      catch (e) {
        if (['ENOTEMPTY', 'EEXIST'].includes((e as NodeJS.ErrnoException).code ?? '')) throw new CaptureError(409, 'run already exists')
        throw e
      }
      await syncDirectory(this.directory)
    } finally { await rm(temporary, { recursive: true, force: true }) }
    return (await this.replay(path, id)).manifest
  }
  async ingest(id: string, signal: 'traces' | 'metrics', format: 'json' | 'protobuf', body: Uint8Array): Promise<void> {
    // Detach before the first await: callers cannot mutate the captured body while it waits for the lock.
    const detached = Buffer.from(body)
    if (detached.length > this.bound.maxRequestBytes) throw new CaptureError(413, 'capture request exceeds byte budget')
    await this.exclusive(id, async (path) => {
      const state = await this.replay(path, id)
      const hash = sha256(detached)
      const retry = state.manifest.records.some((r) => r.signal === signal && r.format === format && r.sha256 === hash)
      if (retry) return // Identical HTTP retries remain successful even after finalization.
      if (state.manifest.status === 'finalized') throw new CaptureError(409, 'run is finalized')
      const records = state.manifest.records
      if (records.length >= this.bound.maxRequests || state.manifest.counts.bytes + detached.length > this.bound.maxBytes) throw new CaptureError(413, 'run exceeds capture request/byte budget')
      const count = await add(state, signal, format, detached) // Validate/conflict-check before writing anything.
      if (records.reduce((n, r) => n + r.observations, 0) + count > this.bound.maxObservations) throw new CaptureError(413, 'run exceeds capture observation budget')
      const name = `${String(records.length).padStart(8, '0')}-${signal}-${format}-${hash}.otlp`
      await atomicWrite(join(path, name), detached)
    })
  }
  async read(id: string): Promise<ReplayedRun> { return this.exclusive(id, (path) => this.replay(path, id)) }
  async list(): Promise<Omit<RunManifest, 'records'>[]> {
    let entries
    try { entries = await readdir(this.directory, { withFileTypes: true }) }
    catch (e) { if (isMissing(e)) return []; throw e }
    const ids = entries.filter((e) => e.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(e.name)).map((e) => e.name).sort()
    if (ids.length > 100) throw new CaptureError(413, 'more than 100 runs: use explicit run IDs or split capture directories')
    const result: Omit<RunManifest, 'records'>[] = []
    for (const id of ids) { const { records: _records, ...header } = (await this.read(id)).manifest; result.push(header) }
    return result
  }
  async finalize(id: string): Promise<RunManifest> {
    return this.exclusive(id, async (path) => {
      const state = await this.replay(path, id)
      if (state.manifest.status === 'finalized') return state.manifest
      const manifest: RunManifest = { ...state.manifest, status: 'finalized', finalizedAt: new Date().toISOString(), incompleteReasons: state.manifest.metadata.incompleteReasons }
      await atomicWrite(join(path, 'finalized.json'), JSON.stringify(manifest))
      return manifest
    })
  }
  /** Export a frozen run as a self-contained directory; artifact bodies remain external hash references. */
  async exportRun(id: string, destination: string): Promise<void> {
    await this.exclusive(id, async (path) => {
      const { manifest } = await this.replay(path, id)
      if (manifest.status !== 'finalized') throw new CaptureError(409, 'finalize the run before export')
      const target = resolve(destination)
      const temporary = `${target}.pending-${randomUUID()}`
      await mkdir(temporary, { mode: 0o700 })
      try {
        for (const name of ['run.json', ...manifest.records.map((r) => r.file), 'finalized.json']) {
          const destination = join(temporary, name)
          await copyFile(join(path, name), destination)
          const file = await open(destination, 'r')
          try { await file.sync() } finally { await file.close() }
        }
        await syncDirectory(temporary)
        // Never replace an existing export, even an empty directory.
        try { await stat(target); throw new CaptureError(409, 'export destination already exists') }
        catch (e) { if (!isMissing(e)) throw e }
        await rename(temporary, target)
        await syncDirectory(dirname(target))
      } finally { await rm(temporary, { recursive: true, force: true }) }
    })
  }
  async listTraces(id: string, input: { limit?: number; offset?: number } = {}) {
    const limit = input.limit ?? 100, offset = input.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new CaptureError(400, 'invalid trace page')
    const state = await this.read(id)
    const traces = summarizeRunTraces(await state.storage.querySpans({ limit: this.bound.maxObservations }))
    const page = traces.slice(offset, offset + limit)
    return { traces: page, total: traces.length, nextOffset: offset + page.length < traces.length ? offset + page.length : null }
  }
  async trace(id: string, traceId: string): Promise<RunTraceDetail> {
    if (!/^[a-f0-9]{32}$/.test(traceId)) throw new CaptureError(400, 'invalid trace ID')
    const state = await this.read(id)
    // Avoid legacy waterfall sorting/depth recursion here: malformed cycles must remain visible to the new viewer.
    const all = (await state.storage.querySpans({ limit: this.bound.maxObservations })).filter((s) => s.traceId === traceId)
    if (!all.length) throw new CaptureError(404, 'trace not captured in this run')
    const spans: NormalizedSpan[] = []
    let bytes = 0
    for (const span of all) {
      const size = Buffer.byteLength(JSON.stringify(span))
      if (size > 16 * 1024 * 1024) throw new CaptureError(413, 'span exceeds timeline response budget')
      if (spans.length === 2000 || bytes + size > 16 * 1024 * 1024) break
      spans.push(span); bytes += size
    }
    const ids = new Set(spans.map((s) => s.spanId))
    const { records: _records, ...run } = state.manifest
    return { traceId, spans, totalSpans: all.length, truncated: spans.length < all.length, missingParentCountInView: spans.filter((s) => s.parentSpanId && !ids.has(s.parentSpanId)).length, run }
  }
  async query(id: string, signal: 'traces' | 'metrics', input: { where?: unknown; limit?: number; offset?: number } = {}) {
    const predicates = validatePredicates(input.where ?? [])
    const limit = input.limit ?? 100
    const offset = input.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new CaptureError(400, 'invalid run page: limit 1..1000, offset >= 0')
    const state = await this.read(id)
    const observations: (NormalizedSpan | MetricObservation)[] = []
    if (signal === 'traces') { for (const span of await state.storage.querySpans({ limit: this.bound.maxObservations })) observations.push(span) }
    else {
      let next: number | null = 0
      while (next !== null) {
        const page = await state.metricStorage.queryMetrics({ limit: 1000, offset: next })
        for (const point of page.points) observations.push(point)
        next = page.nextOffset
      }
    }
    const matches = observations.filter((o) => 'traceId' in o ? matchesPredicates(o.otlp?.resource.attributes, o.otlp?.span.attributes, predicates) : matchesPredicates(o.resource.attributes, o.point.attributes, predicates))
    const page: typeof observations = []
    let bytes = 0
    for (const observation of matches.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(observation))
      if (size > 16 * 1024 * 1024) throw new CaptureError(413, 'observation exceeds run query byte budget')
      if (bytes + size > 16 * 1024 * 1024) break
      page.push(observation); bytes += size
    }
    const nextOffset = offset + page.length < matches.length ? offset + page.length : null
    // Return only the header here: manifests/inventories are available from the dedicated run endpoint.
    const { records: _records, ...run } = state.manifest
    return { run, observations: page, total: matches.length, truncated: offset > 0 || nextOffset !== null, nextOffset }
  }
}

export async function hashArtifact(path: string, mediaType?: string): Promise<{ name: string; sha256: string; sizeBytes: number; mediaType?: string }> {
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); sizeBytes += chunk.length }
  return { name: basename(path), sha256: hash.digest('hex'), sizeBytes, ...(mediaType ? { mediaType } : {}) }
}
