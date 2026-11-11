import { z } from 'zod'
import type { RunManifest } from './run-types.js'
export type { RunManifest, RunMetadata, CaptureRecord } from './run-types.js'

export class CaptureError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export const RUN_SCHEMA = 'next-observe/run/v1' as const
export const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
const text = z.string().max(1000)
const artifact = z.strictObject({ name: text.min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), mediaType: text.optional() })
const metadata = z.strictObject({
  experiment: text.min(1), variant: text.min(1), platform: text.min(1),
  labels: z.record(z.string().max(100), text).default({}),
  sources: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  clocks: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  artifacts: z.array(artifact).max(100).default([]),
  incompleteReasons: z.array(text.min(1)).max(100).default([]),
})
export const recordSchema = z.strictObject({
  file: z.string().regex(/^\d{8}-(traces|metrics)-(json|protobuf)-[a-f0-9]{64}\.otlp$/),
  signal: z.enum(['traces', 'metrics']), format: z.enum(['json', 'protobuf']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), observations: z.number().int().nonnegative(),
})
export const draftSchema = z.strictObject({
  schema: z.literal(RUN_SCHEMA), runId: z.string().regex(RUN_ID), createdAt: z.string().datetime(), metadata,
})
export const manifestSchema = draftSchema.extend({
  status: z.enum(['incomplete', 'finalized']), finalizedAt: z.string().datetime().nullable(),
  incompleteReasons: z.array(text), records: z.array(recordSchema),
  counts: z.strictObject({ requests: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), spans: z.number().int().nonnegative(), metricPoints: z.number().int().nonnegative() }),
  coverage: z.literal('received-requests-only'),
  deduplication: z.literal('traceId/spanId:first-wins;metric-stream/interval:identical-only'),
}) satisfies z.ZodType<RunManifest>
export function runId(value: string): string {
  if (!RUN_ID.test(value)) throw new CaptureError(400, 'runId must be 1..80 letters, digits, _ or -, starting with a letter or digit')
  return value
}
export function parseMetadata(input: unknown): z.output<typeof metadata> {
  return boundedParse(metadata, input)
}
export function boundedParse<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    const encoded = JSON.stringify(input)
    if (Buffer.byteLength(encoded ?? '') > 64 * 1024) throw new Error('metadata exceeds 64 KiB')
    const detached: unknown = JSON.parse(encoded)
    const queue: [unknown, number][] = [[detached, 0]]
    while (queue.length) {
      const [value, depth] = queue.pop()!
      if (depth > 16) throw new Error('metadata exceeds depth 16')
      if (value && typeof value === 'object') for (const child of Object.values(value)) queue.push([child, depth + 1])
    }
    return schema.parse(detached)
  } catch { throw new CaptureError(400, 'invalid run metadata/schema (maximum 64 KiB, depth 16)') }
}
