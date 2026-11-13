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

/** Runner-neutral scenario result. Durations of runner actions are not application performance metrics. */
export interface ScenarioReport {
  schema: 'observe.scenario-report/v1'; id: string; title: string; endpoint: string
  runner: 'playwright' | 'maestro'; protocol: ReportArtifact; limitations: string[]
  runs: {
    runId: string; variant: string; mode: string
    manifestFile: 'run.json' | 'finalized.json'; manifestSha256: string
    status: 'passed' | 'failed' | 'incomplete'
    checks: { name: string; status: 'passed' | 'failed' | 'incomplete'; details: string }[]
    measurements: { name: string; value: number | null; unit: string; source: string; unavailableReason: string | null }[]
    artifacts: ReportArtifact[]
  }[]
}
export type PerformanceComparisonReport = PerformanceReport
export type ExperimentReport = PerformanceReport | ScenarioReport
