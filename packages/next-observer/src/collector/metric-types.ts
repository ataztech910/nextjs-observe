import type { OtlpKeyValue, OtlpResource, OtlpScope } from './otlp-types.js'

export type MetricDouble = number | 'NaN' | 'Infinity' | '-Infinity'
export interface MetricExemplar {
  filteredAttributes: OtlpKeyValue[]
  timeUnixNano: string
  asDouble?: MetricDouble
  asInt?: string
  spanId: string
  traceId: string
}
export interface MetricPointBase {
  attributes: OtlpKeyValue[]
  startTimeUnixNano: string
  timeUnixNano: string
  flags: number
  exemplars: MetricExemplar[]
}
export interface NumberMetricPoint extends MetricPointBase { asDouble?: MetricDouble; asInt?: string }
export interface HistogramMetricPoint extends MetricPointBase {
  count: string
  sum?: number
  bucketCounts: string[]
  explicitBounds: number[]
  min?: number
  max?: number
}
interface MetricIdentity {
  schemaVersion: 1
  resource: OtlpResource
  resourceSchemaUrl: string
  scope: OtlpScope
  scopeSchemaUrl: string
  name: string
  description: string
  unit: string
  metadata: OtlpKeyValue[]
}
export type MetricObservation = MetricIdentity & (
  | { type: 'gauge'; point: NumberMetricPoint }
  | { type: 'sum'; aggregationTemporality: 1 | 2; isMonotonic: boolean; point: NumberMetricPoint }
  | { type: 'histogram'; aggregationTemporality: 1 | 2; point: HistogramMetricPoint }
)
export interface MetricDecodeLimits { maxPoints?: number; maxDepth?: number; maxValues?: number }
export interface MetricFilter {
  name?: string
  service?: string
  fromMs?: number
  toMs?: number
  limit?: number
  offset?: number
}
export interface MetricQueryResult {
  points: MetricObservation[]
  total: number
  truncated: boolean
  nextOffset: number | null
  historyComplete: boolean
}
/** Separate capability from the existing span-only StorageAdapter. */
export interface MetricStorageAdapter {
  insertMetrics(points: MetricObservation[]): Promise<void>
  queryMetrics(filter?: MetricFilter): Promise<MetricQueryResult>
}
