import { attrs, boundOtlp, id, integer, invalid, list, object, resource, str, uint32 } from './otlp-validation-common.js'
import type { HistogramMetricPoint, MetricDecodeLimits, MetricDouble, MetricExemplar, MetricObservation, MetricPointBase, NumberMetricPoint } from './metric-types.js'

type ObjectValue = Record<string, unknown>
function double(v: unknown, p: string, finite = false): MetricDouble {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (!finite && (v === 'NaN' || v === 'Infinity' || v === '-Infinity')) return v
  return invalid(p, finite ? 'expected finite number' : 'expected OTLP double')
}
function numericValue(v: ObjectValue, p: string, allowMissing = false): Pick<NumberMetricPoint, 'asDouble' | 'asInt'> {
  if (v.asDouble !== undefined && v.asInt !== undefined) return invalid(p, 'multiple number values')
  if (v.asInt !== undefined) return { asInt: integer(v.asInt, `${p}.asInt`, true) }
  if (v.asDouble !== undefined) return { asDouble: double(v.asDouble, `${p}.asDouble`) }
  if (!allowMissing) return invalid(p, 'number value is required')
  return {}
}
function exemplars(v: unknown, p: string): MetricExemplar[] {
  return list(v, p).map((x) => {
    const e = object(x, p)
    return { filteredAttributes: attrs(e.filteredAttributes, p), timeUnixNano: integer(e.timeUnixNano ?? '0', p), ...numericValue(e, p), traceId: id(e.traceId, 32, p, true), spanId: id(e.spanId, 16, p, true) }
  })
}
function pointBase(v: ObjectValue, p: string): MetricPointBase {
  const start = integer(v.startTimeUnixNano ?? '0', `${p}.startTimeUnixNano`)
  const end = integer(v.timeUnixNano, `${p}.timeUnixNano`)
  if (end === '0' || BigInt(start) > BigInt(end)) return invalid(p, 'invalid point interval')
  return { attributes: attrs(v.attributes, `${p}.attributes`), startTimeUnixNano: start, timeUnixNano: end, flags: uint32(v.flags, `${p}.flags`), exemplars: exemplars(v.exemplars, `${p}.exemplars`) }
}
function numberPoint(v: ObjectValue, p: string): NumberMetricPoint {
  const base = pointBase(v, p)
  return { ...base, ...numericValue(v, p, (base.flags & 1) !== 0) }
}
function histogramPoint(v: ObjectValue, p: string): HistogramMetricPoint {
  const base = pointBase(v, p)
  const count = integer(v.count ?? '0', `${p}.count`)
  const bucketCounts = list(v.bucketCounts, p).map((n) => integer(n, `${p}.bucketCounts`))
  const explicitBounds = list(v.explicitBounds, p).map((n) => double(n, `${p}.explicitBounds`, true) as number)
  if (explicitBounds.some((n, i) => i > 0 && n <= explicitBounds[i - 1])) return invalid(p, 'histogram bounds must strictly increase')
  if ((bucketCounts.length || explicitBounds.length) && bucketCounts.length !== explicitBounds.length + 1) return invalid(p, 'histogram bucket count/shape mismatch')
  if (bucketCounts.length && bucketCounts.reduce((a, n) => a + BigInt(n), 0n) !== BigInt(count)) return invalid(p, 'histogram buckets do not sum to count')
  const optional: { sum?: number; min?: number; max?: number } = {}
  for (const k of ['sum', 'min', 'max'] as const) if (v[k] !== undefined) optional[k] = double(v[k], `${p}.${k}`, true) as number
  if (optional.min !== undefined && optional.max !== undefined && optional.min > optional.max) return invalid(p, 'histogram min exceeds max')
  for (let i = 0; i < bucketCounts.length; i++) {
    if (BigInt(bucketCounts[i]) === 0n) continue
    if (i < explicitBounds.length && optional.min !== undefined && optional.min > explicitBounds[i]) return invalid(p, 'histogram min contradicts populated bucket')
    if (i > 0 && optional.max !== undefined && optional.max <= explicitBounds[i - 1]) return invalid(p, 'histogram max contradicts populated bucket')
  }
  return { ...base, count, bucketCounts, explicitBounds, ...optional }
}

/** Sum/Gauge/explicit Histogram only. Other known types are rejected, never silently dropped. */
export function decodeOtlpMetrics(input: unknown, limits: MetricDecodeLimits = {}): MetricObservation[] {
  boundOtlp(input, limits)
  const request = object(input, 'request')
  const result: MetricObservation[] = []
  for (const r of list(request.resourceMetrics, 'resourceMetrics')) {
    const rm = object(r, 'resourceMetrics[]')
    const res = resource(rm.resource, 'resource')
    const resourceSchemaUrl = str(rm.schemaUrl, 'resource.schemaUrl')
    for (const s of list(rm.scopeMetrics, 'scopeMetrics')) {
      const sm = object(s, 'scopeMetrics[]')
      const scope = sm.scope === undefined ? {} : object(sm.scope, 'scope')
      const normalizedScope = { ...resource(scope, 'scope'), name: str(scope.name, 'scope.name'), version: str(scope.version, 'scope.version') }
      for (const raw of list(sm.metrics, 'metrics')) {
        const metric = object(raw, 'metric')
        const name = str(metric.name, 'metric.name')
        if (!name) return invalid('metric', 'name is required')
        const types = ['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'].filter((k) => metric[k] !== undefined)
        if (types.length !== 1) return invalid(name, 'exactly one metric data type is required')
        const type = types[0]
        if (type !== 'gauge' && type !== 'sum' && type !== 'histogram') return invalid(name, `unsupported metric type: ${type}`)
        const data = object(metric[type], name)
        const identity = { schemaVersion: 1 as const, resource: res, resourceSchemaUrl, scope: normalizedScope, scopeSchemaUrl: str(sm.schemaUrl, 'scope.schemaUrl'), name, unit: str(metric.unit, name), description: str(metric.description, name), metadata: attrs(metric.metadata, name) }
        const temporality = type === 'gauge' ? undefined : uint32(data.aggregationTemporality, name)
        if (type !== 'gauge' && temporality !== 1 && temporality !== 2) return invalid(name, 'delta or cumulative temporality is required')
        if (type === 'sum' && data.isMonotonic !== undefined && typeof data.isMonotonic !== 'boolean') return invalid(name, 'isMonotonic must be boolean')
        for (const rawPoint of list(data.dataPoints, `${name}.dataPoints`)) {
          if (result.length >= (limits.maxPoints ?? 10_000)) return invalid('request', 'maximum metric point count exceeded')
          const value = object(rawPoint, `${name}.point`)
          if (type === 'histogram') result.push({ ...identity, type, aggregationTemporality: temporality as 1 | 2, point: histogramPoint(value, name) })
          else {
            const point = numberPoint(value, name)
            if (type === 'gauge') result.push({ ...identity, type, point })
            else {
              if (data.isMonotonic && ((point.asInt !== undefined && BigInt(point.asInt) < 0n) || (typeof point.asDouble === 'number' && point.asDouble < 0))) return invalid(name, 'negative monotonic sum')
              result.push({ ...identity, type, aggregationTemporality: temporality as 1 | 2, isMonotonic: data.isMonotonic === true, point })
            }
          }
        }
      }
    }
  }
  return result
}
