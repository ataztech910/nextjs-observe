import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, type NormalizedSpan } from '@/api'
import type { MetricObservation } from '../../../src/collector/metric-types'
import { histogramQuantiles } from '../../../src/collector/metric-query'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RunTimelineCard } from '@/components/run-timeline'
import { performanceNumber } from '@/lib/performance'

export function PerformancePage() {
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/performance' })
  const navigate = useNavigate({ from: '/performance' })
  const features = useQuery({ queryKey: ['performance-features'], queryFn: api.performanceFeatures })
  const runs = useQuery({ queryKey: ['performance-runs'], queryFn: api.performanceRuns, enabled: features.data?.runs === true })
  const reports = useQuery({ queryKey: ['performance-reports'], queryFn: api.performanceReports, enabled: features.data?.reports === true })
  const report = useQuery({ queryKey: ['performance-report', search.report], queryFn: () => api.performanceReport(search.report!), enabled: Boolean(search.report && features.data?.reports) })
  const manifest = useQuery({ queryKey: ['performance-run', search.run], queryFn: () => api.performanceRun(search.run!), enabled: Boolean(search.run && features.data?.runs) })
  useEffect(() => { if (manifest.data && !manifest.isError && window.location.hash === '#selected-run') document.getElementById('selected-run')?.scrollIntoView() }, [manifest.data?.runId, manifest.isError])
  const [variant, setVariant] = useState('')
  const [mode, setMode] = useState('')
  const list = (runs.data?.runs ?? []).filter((r) => (!variant || r.metadata.variant === variant) && (!mode || r.metadata.labels.mode === mode))
  const selectedSamples = report.isError ? undefined : report.data?.runs.find((r) => r.runId === search.run)
  const choose = (key: 'run' | 'report', value: string) => void navigate({ search: (prev) => ({ ...prev, [key]: value || undefined }) })
  const selectClass = 'h-9 max-w-full rounded-md border bg-background px-3 text-sm'
  return <div className="space-y-6">
    <PageHeader title="Performance runs" subtitle="Frozen experiment captures and externally computed comparisons. Select the runs and report explicitly." />
    {features.isError && <p role="alert">Could not load performance features.</p>}
    {features.data && !features.data.runs && <Card className="p-6"><h2 className="font-medium">Run archives are not enabled</h2><p className="text-sm text-muted-foreground">Start the observer with a capture directory to browse experiment runs.</p></Card>}
    {features.data?.runs && <>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-xs text-muted-foreground">Variant<select aria-label="Variant filter" className={selectClass} value={variant} onChange={(e) => setVariant(e.target.value)}><option value="">All variants</option>{[...new Set(runs.data?.runs.map((r) => r.metadata.variant))].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Collection mode<select aria-label="Mode filter" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option>{[...new Set(runs.data?.runs.map((r) => r.metadata.labels.mode).filter(Boolean))].map((v) => <option key={v}>{v}</option>)}</select></label>
        <Button variant="outline" onClick={() => { void runs.refetch(); if (features.data?.reports) void reports.refetch(); if (search.run) { void manifest.refetch(); void queryClient.invalidateQueries({ queryKey: ['run-observations', search.run] }); void queryClient.invalidateQueries({ queryKey: ['run-timeline', search.run] }) } if (search.report) void report.refetch() }}>Refresh archives</Button>
      </div>
      {runs.isError && <p role="alert">Could not read run archives. Check archive integrity and access.</p>}
      {runs.isLoading && <p className="text-muted-foreground">Loading runs…</p>}
      {runs.data && !runs.isError && <Card className="max-h-80 overflow-auto p-0"><table className="w-full text-left text-sm"><thead className="sticky top-0 border-b bg-background text-xs text-muted-foreground"><tr>{['Run', 'Experiment / variant', 'Mode', 'State', 'Spans', 'Metric points'].map((s) => <th key={s} className="p-3 font-medium">{s}</th>)}</tr></thead><tbody>{list.map((run) => <tr key={run.runId} className={`border-b last:border-0 ${search.run === run.runId ? 'bg-muted' : ''}`}><td className="p-3"><Link to="/performance" hash="selected-run" search={{ ...search, run: run.runId, trace: undefined }} className="font-mono text-xs text-signal hover:underline">{run.runId}</Link></td><td className="p-3">{run.metadata.experiment} / {run.metadata.variant}</td><td className="p-3">{run.metadata.labels.mode ?? 'Unspecified'}</td><td className="p-3">{run.status}{run.incompleteReasons.length > 0 && ' · incomplete evidence'}</td><td className="p-3 tabular-nums">{run.counts.spans}</td><td className="p-3 tabular-nums">{run.counts.metricPoints}</td></tr>)}</tbody></table>{list.length === 0 && <p className="p-5 text-muted-foreground">No matching runs.</p>}</Card>}
    </>}
    {features.data?.runs && !features.data.reports && <p className="text-sm text-muted-foreground">External comparison reports are not connected to this observer.</p>}
    {features.data?.reports && <section className="space-y-4">
      <label className="grid gap-1 text-sm">Comparison report<select aria-label="Comparison report" className={selectClass} value={search.report ?? ''} onChange={(e) => choose('report', e.target.value)}><option value="">Select a report</option>{reports.data?.reports.map((r) => <option key={r.id} value={r.id}>{r.title} · {r.runCount} runs</option>)}</select></label>
      {(reports.isError || report.isError) && <p role="alert">Could not verify the comparison report and its artifacts.</p>}
      {reports.data?.errors.map((e) => <p key={e.id} role="alert" className="text-sm text-destructive">Report {e.id}: {e.message}</p>)}
      {report.data && !report.isError && <Card className="gap-4 p-5" data-testid="performance-comparison">
        <h2 className="text-lg font-semibold">{report.data.title}</h2>
        <p className="text-sm text-muted-foreground">{report.data.endpoint}. Each value summarizes run medians after the declared warmup.</p>
        <p className="text-xs text-muted-foreground">Artifact hashes and capture associations checked. Statistical analysis is provided by the external harness.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{['Variant', 'Mode', 'Runs', 'Measured actions', 'Median of run medians (ms)', 'Run median range (ms)'].map((s) => <th key={s} className="p-3 font-medium">{s}</th>)}</tr></thead><tbody>{report.data.groups.filter((g) => (!variant || g.variant === variant) && (!mode || g.mode === mode)).map((g) => <tr key={`${g.variant}/${g.mode}`} className="border-b last:border-0"><td className="p-3">{g.variant}</td><td className="p-3">{g.mode}</td><td className="p-3"><details><summary className="cursor-pointer">{g.runIds.length}</summary><div className="grid gap-2 py-2">{g.runIds.map((id) => <Link key={id} to="/performance" hash="selected-run" search={{ ...search, run: id, trace: undefined }} className="font-mono text-xs text-signal hover:underline">{id}</Link>)}</div></details></td><td className="p-3 tabular-nums">{report.data!.runs.filter((r) => g.runIds.includes(r.runId)).reduce((n, r) => n + r.samples.count, 0)}</td><td className="p-3 tabular-nums">{performanceNumber(g.medianOfRunMediansMs)}</td><td className="p-3 tabular-nums">{performanceNumber(g.minRunMedianMs)}–{performanceNumber(g.maxRunMedianMs)}</td></tr>)}</tbody></table></div>
        <details className="text-sm"><summary className="cursor-pointer">Method, protocol and limitations</summary><p className="mt-3 font-mono text-xs break-all">{report.data.algorithm}<br />Protocol SHA-256: {report.data.protocol.sha256}</p><ul className="my-3 list-disc space-y-1 pl-5 text-muted-foreground">{report.data.limitations.map((s) => <li key={s}>{s}</li>)}</ul></details>
      </Card>}
    </section>}
    {manifest.isError && <p role="alert">Could not verify the selected run.</p>}
    {manifest.data && !manifest.isError && <section id="selected-run" className="scroll-mt-20 space-y-4" key={manifest.data.runId}>
      <h2 className="font-mono text-lg break-all">{manifest.data.runId}</h2>
      <p className="text-sm text-muted-foreground">{manifest.data.metadata.platform} · {manifest.data.status} · Coverage: received requests only. Finalized does not guarantee complete producer delivery.</p>
      {manifest.data.incompleteReasons.length > 0 && <p role="alert" className="text-warning">{manifest.data.incompleteReasons.join('; ')}</p>}
      {selectedSamples && <p className="text-sm" data-testid="selected-run-samples">External harness: {selectedSamples.samples.count} measured actions · {selectedSamples.warmup} warmup actions excluded · p50 {performanceNumber(selectedSamples.samples.p50Ms)} ms · p95 {performanceNumber(selectedSamples.samples.p95Ms)} ms. Raw OTLP observations below retain warmup.</p>}
      <details className="text-sm"><summary className="cursor-pointer">Source, clocks, build and artifact metadata</summary><pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-4 text-xs">{JSON.stringify(manifest.data.metadata, null, 2)}</pre></details>
      <RunTimelineCard runId={manifest.data.runId} traceId={search.trace} onChoose={(trace) => void navigate({ search: (prev) => ({ ...prev, trace: trace || undefined }) })} />
      <Observations runId={manifest.data.runId} signal="spans" />
      <Observations runId={manifest.data.runId} signal="metrics" />
    </section>}
  </div>
}
function Observations({ runId, signal }: { runId: string; signal: 'spans' | 'metrics' }) {
  const [offset, setOffset] = useState(0)
  const data = useQuery({ queryKey: ['run-observations', runId, signal, offset], queryFn: () => api.performanceObservations(runId, signal, offset) })
  const result = data.isError ? undefined : data.data
  return <Card className="gap-4 p-5">
    <h3 className="font-medium">{signal === 'spans' ? 'Captured spans' : 'Raw metric points'}{result && ` · ${result.total}`}</h3>
    {signal === 'metrics' && <p className="text-xs text-muted-foreground">Each point is a separate interval/checkpoint. Cumulative points are not added together. Histogram quantiles are approximate and expressed in the source unit.</p>}
    {data.isError && <p role="alert">Could not read captured observations.</p>}
    {data.isLoading && <p className="text-sm text-muted-foreground">Loading observations…</p>}
    {result?.total === 0 && <p className="text-sm text-muted-foreground">No {signal} captured. Missing telemetry is not a zero-duration measurement; disabled-mode samples may be in the external comparison report.</p>}
    <div className="divide-y">{result?.observations.map((o, index) => <details className="py-3 text-sm" key={offset + index}><summary className="cursor-pointer">{'traceId' in o ? <SpanSummary span={o} /> : <MetricSummary metric={o} />}</summary><pre className="mt-3 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(o, null, 2)}</pre></details>)}</div>
    {result && result.total > 0 && <div className="flex items-center gap-3 text-xs text-muted-foreground"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(0)}>First page</Button><span>Showing {offset + 1}–{offset + result.observations.length} of {result.total}</span><Button variant="outline" disabled={result.nextOffset === null} onClick={() => setOffset(result.nextOffset!)}>Next page</Button></div>}
  </Card>
}
function SpanSummary({ span }: { span: NormalizedSpan }) { return <span><span className="font-mono">{span.name}</span> · {performanceNumber(span.durationMs)} ms · {span.service} · {span.events.length} events</span> }
function MetricSummary({ metric }: { metric: MetricObservation }) {
  const quantiles = metric.type === 'histogram' ? histogramQuantiles(metric.point) : null
  return <span><span className="font-mono">{metric.name}</span> · {metric.type} · {metric.type !== 'gauge' && (metric.aggregationTemporality === 2 ? 'cumulative' : 'delta')}{metric.type === 'histogram' && <> · count {metric.point.count} · approximate p95 {performanceNumber(quantiles?.p95?.estimate)} {metric.unit || '(source unit unspecified)'}</>}</span>
}
