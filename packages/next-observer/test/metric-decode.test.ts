import { describe, expect, it } from 'vitest'
import { decodeOtlpMetrics } from '../src/collector/metric-decode.js'
import { protobufToOtlpMetrics } from '../src/collector/metric-protobuf.js'
import { performanceMetrics } from './fixtures/performance-metrics.js'

const fixture = () => performanceMetrics().json

describe('metric source fidelity', () => {
  it('decodes official JSON/protobuf to identical Sum/Gauge/Histogram points', () => {
    const payload = performanceMetrics()
    const points = decodeOtlpMetrics(payload.json)
    expect(decodeOtlpMetrics(protobufToOtlpMetrics(payload.protobuf))).toEqual(points)
    expect(points).toHaveLength(4)
    expect(points[0]).toMatchObject({ type: 'sum', aggregationTemporality: 2, isMonotonic: true, point: { asInt: '7', timeUnixNano: '1800000001123456789', startTimeUnixNano: '1800000000123456789' } })
    expect(points[1]).toMatchObject({ type: 'sum', aggregationTemporality: 1, isMonotonic: false, point: { asInt: '-3' } })
    expect(points[2]).toMatchObject({ type: 'gauge', point: { asDouble: 42 } })
    expect(points[3]).toMatchObject({ type: 'histogram', aggregationTemporality: 1, unit: 's', point: { count: '10', sum: 4.6, bucketCounts: ['2', '4', '3', '1'], explicitBounds: [0.1, 0.5, 1], min: 0.02, max: 2 } })
    expect(points[3]).toMatchObject({ schemaVersion: 1, resourceSchemaUrl: 'https://example.test/resource/v1', scopeSchemaUrl: 'https://example.test/scope/v1', scope: { name: 'performance-metrics', version: '1.2.3', attributes: [{ key: 'language', value: { stringValue: 'js' } }] } })
  })

  it('preserves independent protobuf sfixed64 values, exemplars and mixed packed/unpacked buckets', () => {
    // Hand-encoded from metrics.proto: signed int64 min/max, full exemplar IDs/attributes, mixed repeated wire encodings.
    const wire = Buffer.from('0a950212920212720a077261772e73756d3a670a6111010000000000000019e80300000000000031ffffffffffffff7f2a3e3a0e0a06726567696f6e12040a02657511e7030000000000003100000000000000802208bbbbbbbbbbbbbbbb2a10aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa40808080800810021801129b010a087261772e686973744a8e010a890111010000000000000019e803000000000000210a000000000000003210020000000000000007000000000000003101000000000000003a08000000000000f03f390000000000000040423e3a0e0a06726567696f6e12040a02657511e7030000000000003100000000000000802208bbbbbbbbbbbbbbbb2a10aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1001', 'hex')
    const points = decodeOtlpMetrics(protobufToOtlpMetrics(wire))
    expect(points[0]).toMatchObject({ type: 'sum', point: { asInt: '9223372036854775807', flags: 0x80000000, exemplars: [{ asInt: '-9223372036854775808', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), filteredAttributes: [{ key: 'region', value: { stringValue: 'eu' } }] }] } })
    expect(points[1]).toMatchObject({ type: 'histogram', point: { count: '10', bucketCounts: ['2', '7', '1'], explicitBounds: [1, 2], exemplars: [{ timeUnixNano: '999', asInt: '-9223372036854775808' }] } })
  })

  it('preserves metadata, exemplars, flags and exact integers without aliasing input', () => {
    const p = fixture(); const m = p.resourceMetrics[0].scopeMetrics[0].metrics[0]
    m.metadata = [{ key: 'source', value: { bytesValue: 'AP8=' } }]
    const point = m.sum.dataPoints[0]
    point.asInt = '9223372036854775807'
    point.flags = 0x80000000
    point.exemplars = [{ filteredAttributes: [{ key: 'weight', value: { intValue: '9007199254740993' } }], timeUnixNano: '1800000001123456788', asInt: '9007199254740993', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }]
    const [decoded] = decodeOtlpMetrics(p)
    point.asInt = '1'
    expect(decoded.point).toMatchObject({ asInt: '9223372036854775807', flags: 0x80000000, exemplars: [{ asInt: '9007199254740993', traceId: 'a'.repeat(32), timeUnixNano: '1800000001123456788' }] })
    expect(decoded.metadata[0].value).toEqual({ bytesValue: 'AP8=' })
  })

  it('retains no-recorded-value markers and non-finite scalar values without turning them into zero', () => {
    const p = fixture(); const m = p.resourceMetrics[0].scopeMetrics[0].metrics[2]
    delete m.gauge.dataPoints[0].asDouble
    m.gauge.dataPoints[0].flags = 1
    expect(decodeOtlpMetrics(p)[2].point).not.toHaveProperty('asDouble')
    m.gauge.dataPoints[0].asDouble = 'NaN'
    expect(decodeOtlpMetrics(p)[2].point).toMatchObject({ asDouble: 'NaN' })
  })

  it('accepts histograms with unknown start or no buckets while retaining population statistics', () => {
    const p = fixture(); const h = p.resourceMetrics[0].scopeMetrics[0].metrics[3].histogram.dataPoints[0]
    delete h.startTimeUnixNano; delete h.bucketCounts; delete h.explicitBounds
    expect(decodeOtlpMetrics(p)[3].point).toMatchObject({ count: '10', startTimeUnixNano: '0', bucketCounts: [], explicitBounds: [] })
    expect(decodeOtlpMetrics({})).toEqual([])
  })
})

describe('metric rejection and bounds', () => {
  it.each(['exponentialHistogram', 'summary'])('explicitly rejects unsupported %s, including empty values', (type) => {
    const p = fixture(); p.resourceMetrics[0].scopeMetrics[0].metrics = [{ name: 'unsupported', [type]: {} }]
    expect(() => decodeOtlpMetrics(p)).toThrow(/unsupported metric type/)
  })
  it('rejects protobuf exponentialHistogram explicitly', () => {
    expect(() => decodeOtlpMetrics(protobufToOtlpMetrics(Buffer.from('0a131211120f0a0b756e737570706f727465645200', 'hex')))).toThrow(/unsupported metric type/)
  })
  it('rejects protobuf summary explicitly', () => {
    expect(() => decodeOtlpMetrics(protobufToOtlpMetrics(Buffer.from('0a131211120f0a0b756e737570706f727465645a00', 'hex')))).toThrow(/unsupported metric type/)
  })
  it.each([null, [], { resourceMetrics: null }, { resourceMetrics: [{ scopeMetrics: 1 }] }])('rejects invalid request %j', (p) => {
    expect(() => decodeOtlpMetrics(p)).toThrow()
  })
  it.each([
    { count: '11' }, { bucketCounts: ['10'] }, { explicitBounds: [0.5, 0.1, 1] }, { explicitBounds: [0.1, 0.1, 1] },
    { bucketCounts: ['-1', '4', '6', '1'] }, { count: '18446744073709551616' }, { min: 3, max: 2 },
    { min: 0.2 }, { max: 0.5 }, { sum: 'Infinity' }, { timeUnixNano: '0' }, { startTimeUnixNano: '9999999999999999999' },
    { exemplars: [{ asDouble: 1, traceId: 'broken' }] },
  ])('rejects invalid histogram %j', (patch) => {
    const p = fixture(); Object.assign(p.resourceMetrics[0].scopeMetrics[0].metrics[3].histogram.dataPoints[0], patch)
    expect(() => decodeOtlpMetrics(p)).toThrow()
  })
  it('requires one numeric value and valid temporality/monotonicity', () => {
    const p = fixture(); const m = p.resourceMetrics[0].scopeMetrics[0].metrics[0]
    m.sum.dataPoints[0].asDouble = 1
    expect(() => decodeOtlpMetrics(p)).toThrow(/multiple/)
    delete m.sum.dataPoints[0].asDouble
    m.sum.dataPoints[0].asInt = '-1'
    expect(() => decodeOtlpMetrics(p)).toThrow(/negative monotonic/)
    m.sum.dataPoints[0].asInt = '1'; m.sum.aggregationTemporality = 0
    expect(() => decodeOtlpMetrics(p)).toThrow(/temporality/)
    m.sum.aggregationTemporality = 1; m.sum.isMonotonic = 'true'
    expect(() => decodeOtlpMetrics(p)).toThrow(/boolean/)
    m.sum.isMonotonic = true; m.gauge = {}
    expect(() => decodeOtlpMetrics(p)).toThrow(/exactly one/)
  })
  it('limits decoded points and bounds protobuf recursion/fields before accepting input', () => {
    const p = performanceMetrics()
    expect(() => decodeOtlpMetrics(p.json, { maxPoints: 3 })).toThrow(/point count/)
    expect(() => decodeOtlpMetrics(p.json, { maxValues: 10 })).toThrow(/too many values/)
    expect(() => protobufToOtlpMetrics(p.protobuf, { maxDepth: 2 })).toThrow(/nesting depth/)
    expect(() => protobufToOtlpMetrics(p.protobuf, { maxValues: 3 })).toThrow(/too many protobuf fields/)
    expect(() => protobufToOtlpMetrics(p.protobuf.subarray(0, p.protobuf.length - 1))).toThrow(/truncated/)
  })
})
