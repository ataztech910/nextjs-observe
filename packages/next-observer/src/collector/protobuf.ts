// OTLP/protobuf ExportTraceServiceRequest → the OTLP/JSON shape decodeOtlpJson() reads, so both formats share one path.
// A minimal reader for the protobuf wire format and only the opentelemetry-proto trace messages — no dependency.
// Field numbers: opentelemetry/proto/{collector/trace/v1/trace_service,trace/v1/trace,common/v1/common,resource/v1/resource}.proto
import type { OtlpTraceRequest } from './otlp-types.js'
import type { TraceDecodeLimits } from './otlp-validation.js'

type Json = Record<string, unknown>

const VARINT = 0
const FIXED64 = 1
const LEN = 2
const FIXED32 = 5

class Reader {
  private pos = 0
  constructor(
    private readonly buf: Uint8Array,
    private readonly depth = 0,
    private readonly budget = { remaining: 250_000 },
    private readonly maxDepth = 32,
  ) {
    if (depth > maxDepth) throw new Error('maximum protobuf nesting depth exceeded')
  }

  message<T>(read: (r: Reader) => T): T {
    return read(new Reader(this.bytes(), this.depth + 1, this.budget, this.maxDepth))
  }

  fixed32(): number { return this.view(4).getUint32(0, true) }

  get done() {
    return this.pos >= this.buf.length
  }

  varint(): bigint {
    let result = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.pos >= this.buf.length) throw new Error('truncated varint')
      const byte = this.buf[this.pos++]
      result |= BigInt(byte & 0x7f) << shift
      if (shift === 63n && byte > 1) throw new Error('varint exceeds uint64')
      if (byte < 0x80) return result
    }
    throw new Error('varint too long')
  }

  fixed64(): bigint {
    const view = this.view(8)
    return view.getBigUint64(0, true)
  }

  double(): number {
    return this.view(8).getFloat64(0, true)
  }

  bytes(): Uint8Array {
    const length = Number(this.varint())
    if (length < 0 || this.pos + length > this.buf.length) throw new Error('truncated field')
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  skip(wireType: number) {
    if (wireType === VARINT) this.varint()
    else if (wireType === FIXED64) this.view(8)
    else if (wireType === LEN) this.bytes()
    else if (wireType === FIXED32) this.view(4)
    else throw new Error(`unsupported wire type ${wireType}`)
  }

  /** Calls `field` for each field; unknown fields must be skipped by the callback via `skip`. */
  fields(field: (number: number, wireType: number) => void) {
    while (!this.done) {
      if (--this.budget.remaining < 0) throw new Error('too many protobuf fields')
      const rawTag = this.varint()
      if (rawTag < 8n || rawTag > 0xffffffffn) throw new Error('invalid protobuf field tag')
      const tag = Number(rawTag)
      field(tag >>> 3, tag & 7)
    }
  }

  private view(length: number): DataView {
    if (this.pos + length > this.buf.length) throw new Error('truncated field')
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, length)
    this.pos += length
    return view
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const finiteDouble = (n: number) => Number.isFinite(n) ? n : String(n)

function anyValue(r: Reader): Json {
  const out: Json = {}
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.stringValue = utf8.decode(r.bytes())
    else if (n === 2 && w === VARINT) out.boolValue = r.varint() !== 0n
    else if (n === 3 && w === VARINT) out.intValue = BigInt.asIntN(64, r.varint()).toString()
    else if (n === 4 && w === FIXED64) out.doubleValue = finiteDouble(r.double())
    else if (n === 5 && w === LEN) out.arrayValue = { values: r.message(repeated(1, anyValue)) }
    else if (n === 6 && w === LEN) out.kvlistValue = { values: r.message(repeated(1, keyValue)) }
    else if (n === 7 && w === LEN) out.bytesValue = Buffer.from(r.bytes()).toString('base64')
    else r.skip(w)
  })
  return out
}

function keyValue(r: Reader): Json {
  const out: Json = { key: '' }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.key = utf8.decode(r.bytes())
    else if (n === 2 && w === LEN) out.value = r.message(anyValue)
    else r.skip(w)
  })
  return out
}

/** A message holding one repeated message field `number` (ArrayValue, KeyValueList). */
function repeated(number: number, item: (r: Reader) => Json) {
  return (r: Reader): Json[] => {
    const items: Json[] = []
    r.fields((n, w) => {
      if (n === number && w === LEN) items.push(r.message(item))
      else r.skip(w)
    })
    return items
  }
}

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

function resource(r: Reader): Json {
  const out: Json = { attributes: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === 2 && w === VARINT) out.droppedAttributesCount = Number(r.varint())
    else r.skip(w)
  })
  return out
}

function scope(r: Reader): Json {
  const out: Json = { attributes: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.name = utf8.decode(r.bytes())
    else if (n === 2 && w === LEN) out.version = utf8.decode(r.bytes())
    else if (n === 3 && w === LEN) (out.attributes as Json[]).push(r.message(keyValue))
    else if (n === 4 && w === VARINT) out.droppedAttributesCount = Number(r.varint())
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
