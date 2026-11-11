import { describe, expect, it } from 'vitest'
import { decodeOtlpJson } from '../src/collector/decode.js'
import { protobufToOtlpJson } from '../src/collector/protobuf.js'
import type { OtlpAnyValue } from '../src/collector/otlp-types.js'
import { performanceTrace, TRACE_ID, SPAN_ID } from './fixtures/performance-trace.js'

const envelope = () => performanceTrace().json
const sourceSpan = (p: ReturnType<typeof envelope>) => p.resourceSpans![0].scopeSpans![0].spans![0]

describe('OTLP performance trace fidelity', () => {
  it('preserves exact times, links, scope/schema/context and dropped counts in both upstream encodings', () => {
    const payload = performanceTrace()
    const json = decodeOtlpJson(payload.json)
    const proto = decodeOtlpJson(protobufToOtlpJson(payload.protobuf))
    expect(proto).toEqual(json)
    const [span] = json
    expect(span).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, startTimeUnixNano: '1800000000123456789', endTimeUnixNano: '1800000000123456890', durationMs: 0.000101 })
    expect(span.links).toEqual([{ traceId: 'd'.repeat(32), spanId: 'e'.repeat(16), traceState: 'vendor=linked', flags: 769, attributes: { reason: 'shared-work' }, droppedAttributesCount: 4 }])
    expect(span.otlp).toMatchObject({
      schemaVersion: 1,
      resourceSchemaUrl: 'https://example.test/resource/v1', scopeSchemaUrl: 'https://example.test/scope/v1',
      scope: { name: 'performance-test', version: '1.2.3' },
      span: { flags: 769, traceState: 'vendor=sample', droppedAttributesCount: 2, droppedEventsCount: 3, droppedLinksCount: 6, events: [{ timeUnixNano: '1800000000123456850', droppedAttributesCount: 5 }] },
    })
  })

  it('retains int64/bytes tags, nested values and scope/resource dropped counts without aliasing the caller', () => {
    const p = envelope()
    const rs = p.resourceSpans![0]
    rs.resource!.droppedAttributesCount = 7
    rs.scopeSpans![0].scope!.attributes = [{ key: 'scope.int', value: { intValue: '9223372036854775807' } }]
    rs.scopeSpans![0].scope!.droppedAttributesCount = 8
    const original = sourceSpan(p)
    original.attributes = [
      { key: 'large', value: { intValue: '9223372036854775807' } },
      { key: 'negative', value: { intValue: '-9223372036854775808' } },
      { key: 'bytes', value: { bytesValue: 'AP8=' } },
      { key: 'nested', value: { kvlistValue: { values: [{ key: '__proto__', value: { arrayValue: { values: [{ intValue: '9007199254740993' }] } } }] } } },
    ]
    const [span] = decodeOtlpJson(p)
    original.attributes[0].value!.intValue = '1'
    expect(span.attributes).toMatchObject({ large: '9223372036854775807', negative: '-9223372036854775808', bytes: 'AP8=' })
    expect(span.attributes.nested).toEqual(JSON.parse('{"__proto__":["9007199254740993"]}'))
    expect(span.otlp!.span.attributes![0].value).toEqual({ intValue: '9223372036854775807' })
    expect(span.otlp!.span.attributes![2].value).toEqual({ bytesValue: 'AP8=' })
    expect(span.otlp).toMatchObject({ resource: { droppedAttributesCount: 7 }, scope: { droppedAttributesCount: 8, attributes: [{ key: 'scope.int', value: { intValue: '9223372036854775807' } }] } })
  })

  it('preserves raw protobuf int64 and bytes beyond the JS SDK numeric range', () => {
    // ResourceSpans → ScopeSpans → span with int64 max and bytes 00 ff.
    const wire = Buffer.from('0a59125712550a10aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1208bbbbbbbbbbbbbbbb2a01783915cd0f9b76e2fa18417acd0f9b76e2fa184a130a056c61726765120a18ffffffffffffffff7f4a0d0a05627974657312043a0200ff', 'hex')
    const [span] = decodeOtlpJson(protobufToOtlpJson(wire))
    expect(span.attributes).toEqual({ large: '9223372036854775807', bytes: 'AP8=' })
    expect(span.otlp!.span.attributes).toEqual([
      { key: 'large', value: { intValue: '9223372036854775807' } },
      { key: 'bytes', value: { bytesValue: 'AP8=' } },
    ])
  })

  it('canonicalizes uppercase IDs for query lookup and deduplication', () => {
    const p = envelope(); const s = sourceSpan(p)
    s.traceId = s.traceId.toUpperCase(); s.spanId = s.spanId.toUpperCase()
    expect(decodeOtlpJson(p)[0]).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID })
  })
})

describe('bounded atomic trace validation', () => {
  it.each([null, [], 5, { resourceSpans: {} }, { resourceSpans: [null] }, { resourceSpans: [{ scopeSpans: 'bad' }] }])('rejects structural invalidity %j', (p) => {
    expect(() => decodeOtlpJson(p)).toThrow()
  })

  it.each([
    { traceId: '0'.repeat(32) }, { spanId: 'xyz' }, { parentSpanId: SPAN_ID }, { parentSpanId: '0'.repeat(16) },
    { startTimeUnixNano: 'not-time' }, { startTimeUnixNano: 1_800_000_000_123456789 },
    { endTimeUnixNano: '1' }, { endTimeUnixNano: '18446744073709551616' }, { name: '' },
    { flags: -1 }, { kind: 'SPAN_KIND_INTERNAL' }, { events: {} },
    { attributes: [{ key: 'n', value: { intValue: '9223372036854775808' } }] },
    { attributes: [{ key: 'n', value: { intValue: 9007199254740992 } }] },
    { attributes: [{ key: 'n', value: { stringValue: 'x', intValue: '1' } }] },
    { attributes: [{ key: 'bytes', value: { bytesValue: 'invalid!' } }] },
    { attributes: [{ key: 'a' }, { key: 'a' }] },
    { links: [{ traceId: '0'.repeat(32), spanId: 'e'.repeat(16) }] },
  ])('rejects invalid span fields %j', (change) => {
    const p = envelope(); Object.assign(sourceSpan(p), change)
    expect(() => decodeOtlpJson(p)).toThrow()
  })

  it('rejects excess span count, nested attributes and value budget; accepts empty OTLP requests', () => {
    const p = envelope(); const ss = p.resourceSpans![0].scopeSpans![0]
    ss.spans!.push({ ...sourceSpan(p), spanId: 'f'.repeat(16) })
    expect(() => decodeOtlpJson(p, { maxSpans: 1 })).toThrow(/span count/)
    expect(() => decodeOtlpJson(p, { maxValues: 10 })).toThrow(/too many values/)
    let nested: OtlpAnyValue = { stringValue: 'deep' }
    for (let i = 0; i < 40; i++) nested = { arrayValue: { values: [nested] } }
    sourceSpan(p).attributes = [{ key: 'deep', value: nested }]
    expect(() => decodeOtlpJson(p)).toThrow(/nesting depth/)
    expect(decodeOtlpJson({})).toEqual([])
    expect(decodeOtlpJson({ resourceSpans: [] })).toEqual([])
  })

  it('bounds protobuf recursion/fields and rejects invalid tags and overflowing varints', () => {
    const bytes = performanceTrace().protobuf
    expect(() => protobufToOtlpJson(bytes, { maxDepth: 2 })).toThrow(/nesting depth/)
    expect(() => protobufToOtlpJson(bytes, { maxValues: 3 })).toThrow(/too many protobuf fields/)
    expect(() => protobufToOtlpJson(Uint8Array.of(0))).toThrow(/field tag/)
    expect(() => protobufToOtlpJson(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2))).toThrow(/uint64/)
  })
})
