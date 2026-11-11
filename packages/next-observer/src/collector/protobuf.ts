// OTLP/protobuf ExportTraceServiceRequest → the OTLP/JSON shape decodeOtlpJson() reads, so both formats share one path.
// A minimal reader for the protobuf wire format and only the opentelemetry-proto trace messages — no dependency.
// Field numbers: opentelemetry/proto/{collector/trace/v1/trace_service,trace/v1/trace,common/v1/common,resource/v1/resource}.proto
import type { OtlpTraceRequest } from './otlp-types.js'
import type { TraceDecodeLimits } from './otlp-validation.js'

import { Reader, VARINT, FIXED64, FIXED32, LEN, utf8, hex, keyValue, repeated, resource, scope, type Json } from './protobuf-common.js'

function event(r: Reader): Json {
  const out: Json = { name: '', timeUnixNano: '0', attributes: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === FIXED64) out.timeUnixNano = r.fixed64().toString()
    else if (n === 2 && w === LEN) out.name = utf8.decode(r.bytes())
    else if (n === 3 && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === 4 && w === VARINT) out.droppedAttributesCount = Number(r.varint())
    else r.skip(w)
  })
  return out
}

function status(r: Reader): Json {
  const out: Json = {}
  r.fields((n, w) => {
    if (n === 2 && w === LEN) out.message = utf8.decode(r.bytes())
    else if (n === 3 && w === VARINT) out.code = Number(r.varint())
    else r.skip(w)
  })
  return out
}

function span(r: Reader): Json {
  const out: Json = { traceId: '', spanId: '', name: '', startTimeUnixNano: '0', endTimeUnixNano: '0', attributes: [] as Json[], events: [] as Json[], links: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.traceId = hex(r.bytes())
    else if (n === 2 && w === LEN) out.spanId = hex(r.bytes())
    else if (n === 3 && w === LEN) out.traceState = utf8.decode(r.bytes())
    else if (n === 4 && w === LEN) out.parentSpanId = hex(r.bytes())
    else if (n === 5 && w === LEN) out.name = utf8.decode(r.bytes())
    else if (n === 6 && w === VARINT) out.kind = Number(r.varint())
    else if (n === 7 && w === FIXED64) out.startTimeUnixNano = r.fixed64().toString()
    else if (n === 8 && w === FIXED64) out.endTimeUnixNano = r.fixed64().toString()
    else if (n === 9 && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === 10 && w === VARINT) out.droppedAttributesCount = Number(r.varint())
    else if (n === 11 && w === LEN) (out.events as Json[]).push(r.message(event))
    else if (n === 12 && w === VARINT) out.droppedEventsCount = Number(r.varint())
    else if (n === 13 && w === LEN) (out.links as Json[]).push(r.message(link))
    else if (n === 14 && w === VARINT) out.droppedLinksCount = Number(r.varint())
    else if (n === 16 && w === FIXED32) out.flags = r.fixed32()
    else if (n === 15 && w === LEN) out.status = r.message(status)
    else r.skip(w)
  })
  return out
}

function link(r: Reader): Json {
  const out: Json = { traceId: '', spanId: '', attributes: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.traceId = hex(r.bytes())
    else if (n === 2 && w === LEN) out.spanId = hex(r.bytes())
    else if (n === 3 && w === LEN) out.traceState = utf8.decode(r.bytes())
    else if (n === 4 && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === 5 && w === VARINT) out.droppedAttributesCount = Number(r.varint())
    else if (n === 6 && w === FIXED32) out.flags = r.fixed32()
    else r.skip(w)
  })
  return out
}

function scopeSpans(r: Reader): Json {
  const out: Json = { spans: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.scope = r.message(scope)
    else if (n === 2 && w === LEN) (out.spans as Json[]).push(r.message(span))
    else if (n === 3 && w === LEN) out.schemaUrl = utf8.decode(r.bytes())
    else r.skip(w)
  })
  return out
}

function resourceSpans(r: Reader): Json {
  const out: Json = { scopeSpans: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.resource = r.message(resource)
    else if (n === 2 && w === LEN) (out.scopeSpans as Json[]).push(r.message(scopeSpans))
    else if (n === 3 && w === LEN) out.schemaUrl = utf8.decode(r.bytes())
    else r.skip(w)
  })
  return out
}

/** Throws on malformed input (the collector answers 400). */
export function protobufToOtlpJson(bytes: Uint8Array, limits: TraceDecodeLimits = {}): OtlpTraceRequest {
  const reader = new Reader(bytes, 0, { remaining: limits.maxValues ?? 250_000 }, limits.maxDepth ?? 32)
  return { resourceSpans: repeated(1, resourceSpans)(reader) } as OtlpTraceRequest
}
