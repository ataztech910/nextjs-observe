export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue }
export type Attributes = Record<string, AttributeValue>

export type SpanKindName = 'unspecified' | 'internal' | 'server' | 'client' | 'producer' | 'consumer'
export type SpanStatusName = 'unset' | 'ok' | 'error'

export interface SpanEvent {
  name: string
  timeMs: number
  attributes: Attributes
}

/** Storage-independent span shape — every storage adapter and every agent tool speaks this. */
export interface NormalizedSpan {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: SpanKindName
  service: string
  serviceVersion: string | null
  scope: string | null
  /** Unix epoch, milliseconds (fractional). */
  startTimeMs: number
  durationMs: number
  status: SpanStatusName
  statusMessage: string | null
  attributes: Attributes
  resource: Attributes
  events: SpanEvent[]
}

export interface TraceFilter {
  service?: string
  /** Case-insensitive substring match on any span name in the trace. */
  operation?: string
  /** Match `operation` as the exact span name instead — "GET /api/products" must not bring "GET /api/products/[id]". */
  exactOperation?: boolean
  /** Minimum duration of the whole trace. */
  minDurationMs?: number
  hasError?: boolean
  fromMs?: number
  toMs?: number
  /** Default 50. */
  limit?: number
}

export interface TraceSummary {
  traceId: string
  rootName: string
  rootService: string
  services: string[]
  startTimeMs: number
  durationMs: number
  spanCount: number
  errorCount: number
  /** A request in this trace is a route's first one after a server start (StorageAdapter.isColdStart). */
  coldStart?: boolean
}

/** A span as /api/traces/:id returns it. */
export type TraceSpan = NormalizedSpan & { coldStart?: boolean }

export interface OperationFilter {
  service?: string
  operation?: string
  fromMs?: number
  toMs?: number
  /** Split stats per service.version — the basis for "which deployment introduced the regression". */
  byVersion?: boolean
  /** Skip Next.js internal spans (see isFrameworkSpan). */
  hideFramework?: boolean
  /** Skip each route's first request in a fresh process (StorageAdapter.isColdStart); counted in `coldStarts`. */
  hideColdStarts?: boolean
}

export interface OperationStats {
  service: string
  /** Set only when stats were requested with byVersion. */
  serviceVersion?: string | null
  operation: string
  count: number
  errorCount: number
  errorRate: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  /** With hideColdStarts: how many cold-start requests were left out. */
  coldStarts?: number
  /** With hideColdStarts: every request was a cold start, so they are kept — these numbers include compile time. */
  onlyColdStarts?: boolean
}

export interface SpanFilter {
  service?: string
  /** Case-insensitive substring match on the span name. */
  operation?: string
  status?: SpanStatusName
  fromMs?: number
  toMs?: number
  /** Default 100. */
  limit?: number
  /** Skip Next.js internal spans (see isFrameworkSpan). */
  hideFramework?: boolean
}

export interface ServiceInfo {
  name: string
  /** In order of first appearance — i.e. deploy order. */
  versions: string[]
  spanCount: number
  lastSeenMs: number
  /** Latest span time per version — the previous version stops sending after a deploy. */
  versionLastSeenMs: Record<string, number>
}

export interface StorageAdapter {
  insertSpans(spans: NormalizedSpan[]): Promise<void>
  queryTraces(filter: TraceFilter): Promise<TraceSummary[]>
  getTrace(traceId: string): Promise<NormalizedSpan[]>
  getOperationStats(filter: OperationFilter): Promise<OperationStats[]>
  /** Most recently received first. */
  querySpans(filter: SpanFilter): Promise<NormalizedSpan[]>
  getServices(): Promise<ServiceInfo[]>
  count(): Promise<number>
  /**
   * True for the first server span of a route in a process (resource `service.instance.id`, sent by next-observe): in
   * `next dev` that request includes compiling the route, so it is not representative latency. False without an id.
   */
  isColdStart(span: NormalizedSpan): boolean
  /** False once old spans have been dropped to make room: "never seen before" can then only mean "not seen in what is left". */
  isHistoryComplete(): boolean
}
