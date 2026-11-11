import type { OtlpAnyValue, OtlpKeyValue } from './otlp-types.js'
import { CaptureError } from './run-manifest.js'

/** Exact typed scalar equality; no regex, expression language or coercion of int64 to number. */
export interface RunPredicate { target: 'resource' | 'observation'; key: string; value: OtlpAnyValue }
export const RUN_ATTRIBUTE_ALLOWLIST = [
  'service.name', 'service.version', 'service.instance.id',
  'experiment.id', 'experiment.run_id', 'experiment.variant', 'experiment.scenario',
  'observe.perf.phase', 'observe.perf.source', 'observe.perf.mode',
  'device.id', 'os.type', 'os.version', 'runtime.name', 'runtime.version',
] as const
export function validatePredicates(input: unknown): RunPredicate[] {
  if (!Array.isArray(input) || input.length > 16) throw new CaptureError(400, 'where must be an array of at most 16 equality predicates')
  return input.map((p: RunPredicate) => {
    if (!p || !['resource', 'observation'].includes(p.target) || !(RUN_ATTRIBUTE_ALLOWLIST as readonly string[]).includes(p.key) || !p.value || typeof p.value !== 'object' || Object.keys(p.value).length !== 1 || Object.keys(p).sort().join(',') !== 'key,target,value') throw new CaptureError(400, 'invalid or non-allowlisted run predicate')
    const v = p.value
    const valid = typeof v.stringValue === 'string' && v.stringValue.length <= 1000
      || typeof v.boolValue === 'boolean'
      || typeof v.doubleValue === 'number' && Number.isFinite(v.doubleValue)
      || typeof v.intValue === 'string' && /^-?(0|[1-9]\d{0,18})$/.test(v.intValue) && BigInt(v.intValue) >= -(1n << 63n) && BigInt(v.intValue) < (1n << 63n)
    if (!valid) throw new CaptureError(400, 'predicate value must be a typed scalar (intValue uses a decimal string)')
    return p
  })
}
export function matchesPredicates(resource: OtlpKeyValue[] = [], observation: OtlpKeyValue[] = [], predicates: RunPredicate[]): boolean {
  // Every predicate is tested against this one span/point, never against different spans in a trace.
  return predicates.every((p) => {
    const actual = (p.target === 'resource' ? resource : observation).find((a) => a.key === p.key)?.value
    const [type, expected] = Object.entries(p.value)[0]
    return actual !== undefined && actual[type as keyof OtlpAnyValue] === expected
  })
}
