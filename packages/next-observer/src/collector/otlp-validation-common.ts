import type { OtlpAnyValue, OtlpKeyValue, OtlpResource } from './otlp-types.js'

export class OtlpValidationError extends Error {}

export const invalid = (path: string, reason: string): never => { throw new OtlpValidationError(`${path}: ${reason}`) }
export const object = (v: unknown, p: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid(p, 'expected object')
  return v as Record<string, unknown>
}
export const list = (v: unknown, p: string): unknown[] => {
  if (v === undefined) return []
  if (!Array.isArray(v)) return invalid(p, 'expected array')
  return v
}
export const str = (v: unknown, p: string, fallback = ''): string => {
  if (v === undefined) return fallback
  if (typeof v !== 'string') return invalid(p, 'expected string')
  return v
}
export const uint32 = (v: unknown, p: string): number => {
  if (v === undefined) return 0
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) return invalid(p, 'expected uint32')
  return v
}
export function integer(v: unknown, p: string, signed = false): string {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) return invalid(p, 'unsafe integer; send a decimal string')
  if ((typeof v !== 'number' && typeof v !== 'string') || !/^-?\d+$/.test(String(v))) return invalid(p, 'expected decimal integer')
  if (String(v).length > 21) return invalid(p, 'integer out of range')
  const n = BigInt(v)
  if (n < (signed ? -(1n << 63n) : 0n) || n > (signed ? (1n << 63n) - 1n : (1n << 64n) - 1n)) return invalid(p, 'integer out of range')
  return n.toString()
}
export function id(v: unknown, length: number, p: string, optional = false): string {
  if (optional && (v === undefined || v === '')) return ''
  if (typeof v !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(v) || /^0+$/.test(v)) return invalid(p, 'invalid nonzero hex ID')
  return v.toLowerCase()
}
export function any(v: unknown, p: string): OtlpAnyValue {
  const a = object(v, p)
  const fields = ['stringValue', 'boolValue', 'intValue', 'doubleValue', 'bytesValue', 'arrayValue', 'kvlistValue'].filter((k) => a[k] !== undefined)
  if (fields.length > 1) return invalid(p, 'AnyValue has multiple values')
  const k = fields[0]
  if (!k) return {}
  if (k === 'stringValue') return { stringValue: str(a[k], p) }
  if (k === 'boolValue') {
    if (typeof a[k] !== 'boolean') return invalid(p, 'expected boolean')
    return { boolValue: a[k] as boolean }
  }
  if (k === 'intValue') return { intValue: integer(a[k], p, true) }
  if (k === 'doubleValue') {
    if (typeof a[k] === 'number' && Number.isFinite(a[k])) return { doubleValue: a[k] as number }
    if (['NaN', 'Infinity', '-Infinity'].includes(a[k] as string)) return { doubleValue: a[k] as 'NaN' | 'Infinity' | '-Infinity' }
    return invalid(p, 'invalid double')
  }
  if (k === 'bytesValue') {
    const s = str(a[k], p)
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)?$/.test(s)) return invalid(p, 'invalid base64')
    return { bytesValue: Buffer.from(s, 'base64').toString('base64') }
  }
  const container = object(a[k], `${p}.${k}`)
  return k === 'arrayValue'
    ? { arrayValue: { values: list(container.values, p).map((x, i) => any(x, `${p}[${i}]`)) } }
    : { kvlistValue: { values: attrs(container.values, p) } }
}
export function attrs(v: unknown, p: string): OtlpKeyValue[] {
  const keys = new Set<string>()
  return list(v, p).map((x, i) => {
    const kv = object(x, `${p}[${i}]`)
    if (typeof kv.key !== 'string') return invalid(p, 'attribute key must be a string')
    if (keys.has(kv.key)) return invalid(p, 'duplicate attribute key')
    keys.add(kv.key)
    return { key: kv.key, value: kv.value === undefined ? {} : any(kv.value, `${p}.${kv.key}`) }
  })
}
export function resource(v: unknown, p: string): OtlpResource {
  const r = v === undefined ? {} : object(v, p)
  return { attributes: attrs(r.attributes, `${p}.attributes`), droppedAttributesCount: uint32(r.droppedAttributesCount, p) }
}

export function boundOtlp(input: unknown, limits: { maxDepth?: number; maxValues?: number } = {}): void {
  const maxDepth = limits.maxDepth ?? 32
  let budget = limits.maxValues ?? 250_000
  function visit(v: unknown, depth: number): void {
    if (--budget < 0) return invalid('request', 'too many values')
    if (!v || typeof v !== 'object') return
    if (depth > maxDepth) return invalid('request', 'maximum nesting depth exceeded')
    for (const item of Object.values(v)) visit(item, depth + 1)
  }
  visit(input, 0)
}
