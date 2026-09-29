// OTLP/JSON (ExportTraceServiceRequest) → NormalizedSpan[].
// OTLP/JSON specifics: ids are hex strings, 64-bit ints (times, intValue) may come as strings, enums as numbers.
import type { Attributes, AttributeValue, NormalizedSpan, SpanKindName, SpanStatusName } from './types.js'

interface OtlpAnyValue {
  stringValue?: string
  boolValue?: boolean
  intValue?: string | number
  doubleValue?: number
  bytesValue?: string
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}
interface OtlpKeyValue {
  key: string
  value?: OtlpAnyValue
}
interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string | number
  endTimeUnixNano: string | number
  attributes?: OtlpKeyValue[]
  events?: { name: string; timeUnixNano: string | number; attributes?: OtlpKeyValue[] }[]
  status?: { code?: number; message?: string }
}
export interface OtlpTraceRequest {
  resourceSpans?: {
    resource?: { attributes?: OtlpKeyValue[] }
    scopeSpans?: { scope?: { name?: string }; spans?: OtlpSpan[] }[]
  }[]
}

const KINDS: SpanKindName[] = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']
const STATUSES: SpanStatusName[] = ['unset', 'ok', 'error']

function value(v: OtlpAnyValue | undefined): AttributeValue {
  if (!v) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.bytesValue !== undefined) return v.bytesValue
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(value)
  if (v.kvlistValue) return attributes(v.kvlistValue.values)
  return null
}

function attributes(list: OtlpKeyValue[] = []): Attributes {
  return Object.fromEntries(list.map((kv) => [kv.key, value(kv.value)]))
}

// BigInt keeps nanosecond precision until the final division; Number(ns) would lose it.
const nanosToMs = (ns: string | number) => Number(BigInt(ns) / 1000n) / 1000

export function decodeOtlpJson(request: OtlpTraceRequest): NormalizedSpan[] {
  const spans: NormalizedSpan[] = []
  for (const rs of request.resourceSpans ?? []) {
    const resource = attributes(rs.resource?.attributes)
    const service = typeof resource['service.name'] === 'string' ? resource['service.name'] : 'unknown'
    const serviceVersion = typeof resource['service.version'] === 'string' ? resource['service.version'] : null
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        // Duration is subtracted in nanoseconds: epoch-ms floats (~1.8e12) can't hold sub-µs differences.
        const durationNs = BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)
        spans.push({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId || null,
          name: s.name,
          kind: KINDS[s.kind ?? 0] ?? 'unspecified',
          service,
          serviceVersion,
          scope: ss.scope?.name ?? null,
          startTimeMs: nanosToMs(s.startTimeUnixNano),
          durationMs: Number(durationNs) / 1e6,
          status: STATUSES[s.status?.code ?? 0] ?? 'unset',
          statusMessage: s.status?.message || null,
          attributes: attributes(s.attributes),
          resource,
          events: (s.events ?? []).map((e) => ({ name: e.name, timeMs: nanosToMs(e.timeUnixNano), attributes: attributes(e.attributes) })),
        })
      }
    }
  }
  return spans
}
