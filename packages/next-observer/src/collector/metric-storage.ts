import { createHash } from 'node:crypto'
import type { OtlpAnyValue, OtlpKeyValue } from './otlp-types.js'
import { OtlpValidationError } from './otlp-validation-common.js'
import type { MetricFilter, MetricObservation, MetricQueryResult, MetricStorageAdapter } from './metric-types.js'

function attributeValue(v: OtlpAnyValue | undefined): unknown {
  if (v?.kvlistValue) return { kvlistValue: { values: attributes(v.kvlistValue.values) } }
  if (v?.arrayValue) return { arrayValue: { values: (v.arrayValue.values ?? []).map(attributeValue) } }
  return v
}
function attributes(list: OtlpKeyValue[] = []): unknown {
  return [...list].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((a) => ({ key: a.key, value: attributeValue(a.value) }))
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')
interface SourceHashes { resource: string; scope: string; fullResource: string; fullScope: string; metadata: string }
function identity(m: MetricObservation, source: SourceHashes): string {
  return digest({
    resource: source.resource, scope: source.scope,
    name: m.name, unit: m.unit, type: m.type,
    temporality: m.type === 'gauge' ? null : m.aggregationTemporality,
    monotonic: m.type === 'sum' ? m.isMonotonic : null,
    attributes: attributes(m.point.attributes), start: m.point.startTimeUnixNano, end: m.point.timeUnixNano,
  })
}
function fingerprint(m: MetricObservation, source: SourceHashes): string {
  return digest({
    ...m,
    resource: source.fullResource, scope: source.fullScope, metadata: source.metadata,
    point: { ...m.point, attributes: attributes(m.point.attributes), exemplars: m.point.exemplars.map((e) => ({ ...e, filteredAttributes: attributes(e.filteredAttributes) })).sort((a, b) => stable(a).localeCompare(stable(b))) },
  })
}

/** Bounded raw-point retention. No automatic summation, cumulative differencing or histogram re-bucketing. */
export class MemoryMetricStorage implements MetricStorageAdapter {
  private readonly entries = new Map<string, { observation: MetricObservation; fingerprint: string }>()
  private evicted = false
  constructor(private readonly maxPoints = 100_000, private readonly maxQueryBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) throw new Error('maxPoints must be a positive safe integer')
    if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) throw new Error('maxQueryBytes must be a positive safe integer')
  }
  async insertMetrics(points: MetricObservation[]): Promise<void> {
    const pending = new Map<string, { observation: MetricObservation; fingerprint: string }>()
    // Clone the batch once: shared resource/scope objects must not be copied per data point.
    const detached = structuredClone(points)
    const hashes = new WeakMap<object, Map<string, string>>()
    const cached = (object: object, key: string, value: () => unknown): string => {
      let entries = hashes.get(object)
      if (!entries) { entries = new Map(); hashes.set(object, entries) }
      let hash = entries.get(key)
      if (hash === undefined) { hash = digest(value()); entries.set(key, hash) }
      return hash
    }
    for (const point of detached) {
      const source: SourceHashes = {
        resource: cached(point.resource, `identity:${point.resourceSchemaUrl}`, () => ({ attributes: attributes(point.resource.attributes), schemaUrl: point.resourceSchemaUrl })),
        fullResource: cached(point.resource, 'full', () => ({ ...point.resource, attributes: attributes(point.resource.attributes) })),
        scope: cached(point.scope, `identity:${point.scopeSchemaUrl}`, () => ({ name: point.scope.name, version: point.scope.version, attributes: attributes(point.scope.attributes), schemaUrl: point.scopeSchemaUrl })),
        fullScope: cached(point.scope, 'full', () => ({ ...point.scope, attributes: attributes(point.scope.attributes) })),
        metadata: cached(point.metadata, 'metadata', () => attributes(point.metadata)),
      }
      const key = identity(point, source)
      const hash = fingerprint(point, source)
      const previous = pending.get(key) ?? this.entries.get(key)
      if (previous) {
        if (previous.fingerprint !== hash) throw new OtlpValidationError('conflicting metric point for the same stream and interval')
        continue
      }
      pending.set(key, { observation: point, fingerprint: hash })
    }
    // No await: a conflicting batch makes no changes; concurrent HTTP requests cannot interleave this commit.
    for (const [key, entry] of pending) this.entries.set(key, entry)
    while (this.entries.size > this.maxPoints) {
      this.evicted = true
      this.entries.delete(this.entries.keys().next().value!)
    }
  }
  async queryMetrics(filter: MetricFilter = {}): Promise<MetricQueryResult> {
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) throw new OtlpValidationError('invalid metric page: limit 1..1000, offset >= 0')
    if ([filter.fromMs, filter.toMs].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0 || v > 18_446_744_073_709))) throw new OtlpValidationError('metric time filters must be finite epoch milliseconds within uint64 range')
    if (filter.fromMs !== undefined && filter.toMs !== undefined && filter.fromMs > filter.toMs) throw new OtlpValidationError('metric time range is reversed')
    const from = filter.fromMs === undefined ? undefined : BigInt(Math.ceil(filter.fromMs * 1e6))
    const to = filter.toMs === undefined ? undefined : BigInt(Math.floor(filter.toMs * 1e6))
    const matches: MetricObservation[] = []
    for (const { observation: m } of this.entries.values()) {
      if (filter.name !== undefined && m.name !== filter.name) continue
      if (filter.service !== undefined && !m.resource.attributes?.some((a) => a.key === 'service.name' && a.value?.stringValue === filter.service)) continue
      const time = BigInt(m.point.timeUnixNano)
      if ((from !== undefined && time < from) || (to !== undefined && time > to)) continue
      matches.push(m)
    }
    matches.sort((a, b) => BigInt(a.point.timeUnixNano) < BigInt(b.point.timeUnixNano) ? -1 : BigInt(a.point.timeUnixNano) > BigInt(b.point.timeUnixNano) ? 1 : 0)
    const page: MetricObservation[] = []
    let bytes = 0
    for (const point of matches.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(point), 'utf8')
      if (size > this.maxQueryBytes) throw new OtlpValidationError('metric point exceeds query response byte budget')
      if (bytes + size > this.maxQueryBytes) break
      page.push(point)
      bytes += size
    }
    const nextOffset = offset + page.length < matches.length ? offset + page.length : null
    return { points: structuredClone(page), total: matches.length, truncated: offset > 0 || nextOffset !== null, nextOffset, historyComplete: !this.evicted }
  }
}
