/** Browser-safe contracts. Runtime archive validation lives in run-manifest.ts. */
export interface RunArtifact { name: string; sha256: string; sizeBytes: number; mediaType?: string }
export interface RunMetadata {
  experiment: string; variant: string; platform: string
  labels?: Record<string, string>
  sources?: Record<string, unknown>[]
  clocks?: Record<string, unknown>[]
  artifacts?: RunArtifact[]
  incompleteReasons?: string[]
}
export interface CaptureRecord { file: string; signal: 'traces' | 'metrics'; format: 'json' | 'protobuf'; sha256: string; bytes: number; observations: number }
export interface RunManifest {
  schema: 'next-observe/run/v1'; runId: string; createdAt: string; metadata: Required<RunMetadata>
  status: 'incomplete' | 'finalized'; finalizedAt: string | null; incompleteReasons: string[]; records: CaptureRecord[]
  counts: { requests: number; bytes: number; spans: number; metricPoints: number }
  coverage: 'received-requests-only'
  deduplication: 'traceId/spanId:first-wins;metric-stream/interval:identical-only'
}
export interface RunTraceSummary { traceId: string; name: string; spanCount: number; errorCount: number; missingParentCount: number; startTimeMs: number; durationMs: number; services: string[] }
export interface RunTraceDetail {
  traceId: string; spans: import('./types.js').NormalizedSpan[]; totalSpans: number; truncated: boolean
  missingParentCountInView: number
  run: Omit<RunManifest, 'records'>
}
