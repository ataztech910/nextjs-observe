import { Reader, VARINT, FIXED64, LEN, utf8, hex, finiteDouble, keyValue, repeated, resource, scope, type Json } from './protobuf-common.js'
import type { MetricDecodeLimits } from './metric-types.js'

function packed<T>(r: Reader, wire: number, read: (r: Reader) => T): T[] {
  if (wire === FIXED64) return [read(r)]
  return r.message((p) => {
    const values: T[] = []
    while (!p.done) { p.consume(); values.push(read(p)) }
    return values
  })
}
function exemplar(r: Reader): Json {
  const out: Json = { filteredAttributes: [] as Json[] }
  r.fields((n, w) => {
    if (n === 7 && w === LEN) (out.filteredAttributes as Json[]).push(r.message(keyValue))
    else if (n === 2 && w === FIXED64) out.timeUnixNano = r.fixed64().toString()
    else if (n === 3 && w === FIXED64) out.asDouble = finiteDouble(r.double())
    else if (n === 6 && w === FIXED64) out.asInt = BigInt.asIntN(64, r.fixed64()).toString()
    else if (n === 4 && w === LEN) out.spanId = hex(r.bytes())
    else if (n === 5 && w === LEN) out.traceId = hex(r.bytes())
    else r.skip(w)
  })
  return out
}
function point(r: Reader, histogram: boolean): Json {
  const out: Json = { attributes: [] as Json[], exemplars: [] as Json[] }
  if (histogram) { out.bucketCounts = []; out.explicitBounds = [] }
  r.fields((n, w) => {
    if (n === 2 && w === FIXED64) out.startTimeUnixNano = r.fixed64().toString()
    else if (n === 3 && w === FIXED64) out.timeUnixNano = r.fixed64().toString()
    else if (n === (histogram ? 9 : 7) && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === (histogram ? 8 : 5) && w === LEN) (out.exemplars as Json[]).push(r.message(exemplar))
    else if (n === (histogram ? 10 : 8) && w === VARINT) out.flags = Number(r.varint())
    else if (!histogram && n === 4 && w === FIXED64) out.asDouble = finiteDouble(r.double())
    else if (!histogram && n === 6 && w === FIXED64) out.asInt = BigInt.asIntN(64, r.fixed64()).toString()
    else if (histogram && n === 4 && w === FIXED64) out.count = r.fixed64().toString()
    else if (histogram && n === 5 && w === FIXED64) out.sum = finiteDouble(r.double())
    else if (histogram && n === 6 && (w === LEN || w === FIXED64)) { for (const value of packed(r, w, (p) => p.fixed64().toString())) (out.bucketCounts as string[]).push(value) }
    else if (histogram && n === 7 && (w === LEN || w === FIXED64)) { for (const value of packed(r, w, (p) => finiteDouble(p.double()))) (out.explicitBounds as (number | string)[]).push(value) }
    else if (histogram && n === 11 && w === FIXED64) out.min = finiteDouble(r.double())
    else if (histogram && n === 12 && w === FIXED64) out.max = finiteDouble(r.double())
    else r.skip(w)
  })
  return out
}
function data(r: Reader, type: 'gauge' | 'sum' | 'histogram'): Json {
  const out: Json = { dataPoints: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) (out.dataPoints as Json[]).push(r.message((p) => point(p, type === 'histogram')))
    else if (n === 2 && w === VARINT && type !== 'gauge') out.aggregationTemporality = Number(r.varint())
    else if (n === 3 && w === VARINT && type === 'sum') out.isMonotonic = r.varint() !== 0n
    else r.skip(w)
  })
  return out
}
function metric(r: Reader): Json {
  const out: Json = { metadata: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.name = utf8.decode(r.bytes())
    else if (n === 2 && w === LEN) out.description = utf8.decode(r.bytes())
    else if (n === 3 && w === LEN) out.unit = utf8.decode(r.bytes())
    else if (n === 12 && w === LEN) (out.metadata as Json[]).push(r.message(keyValue))
    else if (n === 5 && w === LEN) out.gauge = r.message((p) => data(p, 'gauge'))
    else if (n === 7 && w === LEN) out.sum = r.message((p) => data(p, 'sum'))
    else if (n === 9 && w === LEN) out.histogram = r.message((p) => data(p, 'histogram'))
    else if ((n === 10 || n === 11) && w === LEN) {
      // Mark unsupported types so common validation rejects even an empty instance.
      r.bytes()
      out[n === 10 ? 'exponentialHistogram' : 'summary'] = {}
    } else r.skip(w)
  })
  return out
}
function scopeMetrics(r: Reader): Json {
  const out: Json = { metrics: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.scope = r.message(scope)
    else if (n === 2 && w === LEN) (out.metrics as Json[]).push(r.message(metric))
    else if (n === 3 && w === LEN) out.schemaUrl = utf8.decode(r.bytes())
    else r.skip(w)
  })
  return out
}
function resourceMetrics(r: Reader): Json {
  const out: Json = { scopeMetrics: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.resource = r.message(resource)
    else if (n === 2 && w === LEN) (out.scopeMetrics as Json[]).push(r.message(scopeMetrics))
    else if (n === 3 && w === LEN) out.schemaUrl = utf8.decode(r.bytes())
    else r.skip(w)
  })
  return out
}
export function protobufToOtlpMetrics(bytes: Uint8Array, limits: MetricDecodeLimits = {}): unknown {
  return { resourceMetrics: repeated(1, resourceMetrics)(new Reader(bytes, 0, { remaining: limits.maxValues ?? 250_000 }, limits.maxDepth ?? 32)) }
}
