/** External analysis presentation contract. Source observations remain OTLP/external artifacts. */
export interface ReportArtifact { name: string; sha256: string }
export interface PerformanceSampleSummary { count: number; p50Ms: number | null; p75Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null }
export interface PerformanceReport {
  schema: 'observe.performance-report/v1'; id: string; title: string; endpoint: string
  analysisUnit: 'run-median'; algorithm: string; protocol: ReportArtifact
  runs: { runId: string; variant: string; mode: string; block: number; warmup: number; samples: PerformanceSampleSummary; manifestSha256: string; sampleArtifact: ReportArtifact }[]
  groups: { variant: string; mode: string; runIds: string[]; medianOfRunMediansMs: number; minRunMedianMs: number; maxRunMedianMs: number }[]
  limitations: string[]
}
export interface PerformanceReportHeader { id: string; title: string; endpoint: string; runCount: number }
export interface PerformanceReportList { reports: PerformanceReportHeader[]; errors: { id: string; message: string }[] }
