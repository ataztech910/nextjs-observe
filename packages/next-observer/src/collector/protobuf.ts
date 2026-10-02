// OTLP/protobuf ExportTraceServiceRequest → the OTLP/JSON shape decodeOtlpJson() reads, so both formats share one path.
// A minimal reader for the protobuf wire format and only the opentelemetry-proto trace messages — no dependency.
// Field numbers: opentelemetry/proto/{collector/trace/v1/trace_service,trace/v1/trace,common/v1/common,resource/v1/resource}.proto
import type { OtlpTraceRequest } from './decode.js'

type Json = Record<string, unknown>

const VARINT = 0
const FIXED64 = 1
const LEN = 2
const FIXED32 = 5

class Reader {
  private pos = 0
  constructor(private readonly buf: Uint8Array) {}

  get done() {
    return this.pos >= this.buf.length
  }

  varint(): bigint {
    let result = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.pos >= this.buf.length) throw new Error('truncated varint')
      const byte = this.buf[this.pos++]
      result |= BigInt(byte & 0x7f) << shift
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
      const tag = Number(this.varint())
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

const utf8 = new TextDecoder('utf-8', { fatal: false })
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

function messages<T>(bytes: Uint8Array, read: (r: Reader) => T): T {
  return read(new Reader(bytes))
}

function anyValue(r: Reader): Json {
  const out: Json = {}
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.stringValue = utf8.decode(r.bytes())
    else if (n === 2 && w === VARINT) out.boolValue = r.varint() !== 0n
    else if (n === 3 && w === VARINT) out.intValue = BigInt.asIntN(64, r.varint()).toString()
    else if (n === 4 && w === FIXED64) out.doubleValue = r.double()
    else if (n === 5 && w === LEN) out.arrayValue = { values: messages(r.bytes(), repeated(1, anyValue)) }
    else if (n === 6 && w === LEN) out.kvlistValue = { values: messages(r.bytes(), repeated(1, keyValue)) }
    else if (n === 7 && w === LEN) out.bytesValue = Buffer.from(r.bytes()).toString('base64')
    else r.skip(w)
  })
  return out
}

function keyValue(r: Reader): Json {
  const out: Json = { key: '' }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.key = utf8.decode(r.bytes())
    else if (n === 2 && w === LEN) out.value = messages(r.bytes(), anyValue)
    else r.skip(w)
  })
  return out
}

/** A message holding one repeated message field `number` (ArrayValue, KeyValueList). */
function repeated(number: number, item: (r: Reader) => Json) {
  return (r: Reader): Json[] => {
    const items: Json[] = []
    r.fields((n, w) => {
      if (n === number && w === LEN) items.push(messages(r.bytes(), item))
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
    else if (n === 3 && w === LEN) (out.attributes as Json[]).push(messages(r.bytes(), keyValue))
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
  const out: Json = { traceId: '', spanId: '', name: '', startTimeUnixNano: '0', endTimeUnixNano: '0', attributes: [] as Json[], events: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.traceId = hex(r.bytes())
    else if (n === 2 && w === LEN) out.spanId = hex(r.bytes())
    else if (n === 4 && w === LEN) out.parentSpanId = hex(r.bytes())
    else if (n === 5 && w === LEN) out.name = utf8.decode(r.bytes())
    else if (n === 6 && w === VARINT) out.kind = Number(r.varint())
    else if (n === 7 && w === FIXED64) out.startTimeUnixNano = r.fixed64().toString()
    else if (n === 8 && w === FIXED64) out.endTimeUnixNano = r.fixed64().toString()
    else if (n === 9 && w === LEN) (out.attributes as Json[]).push(messages(r.bytes(), keyValue))
    else if (n === 11 && w === LEN) (out.events as Json[]).push(messages(r.bytes(), event))
    else if (n === 15 && w === LEN) out.status = messages(r.bytes(), status)
    else r.skip(w)
  })
  return out
}

function scopeSpans(r: Reader): Json {
  const out: Json = { spans: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) {
      out.scope = messages(r.bytes(), (s) => {
        const scope: Json = {}
        s.fields((sn, sw) => (sn === 1 && sw === LEN ? (scope.name = utf8.decode(s.bytes())) : s.skip(sw)))
        return scope
      })
    } else if (n === 2 && w === LEN) (out.spans as Json[]).push(messages(r.bytes(), span))
    else r.skip(w)
  })
  return out
}

function resourceSpans(r: Reader): Json {
  const out: Json = { resource: { attributes: [] as Json[] }, scopeSpans: [] as Json[] }
  r.fields((n, w) => {
    if (n === 1 && w === LEN) out.resource = { attributes: messages(r.bytes(), repeated(1, keyValue)) }
    else if (n === 2 && w === LEN) (out.scopeSpans as Json[]).push(messages(r.bytes(), scopeSpans))
    else r.skip(w)
  })
  return out
}

/** Throws on malformed input (the collector answers 400). */
export function protobufToOtlpJson(bytes: Uint8Array): OtlpTraceRequest {
  return { resourceSpans: messages(bytes, repeated(1, resourceSpans)) } as OtlpTraceRequest
}
