import { Link } from '@tanstack/react-router'
import type { MetricObservation } from '../../../src/collector/metric-types'
import { histogramQuantiles } from '../../../src/collector/metric-query'
import { exemplarTarget, histogramBuckets, metricValue } from '@/lib/metric-evidence'

export function MetricEvidence({ metric, runId }: { metric: MetricObservation; runId: string }) {
  const point = metric.point
  const unit = metric.unit || '(unit unspecified)'
  const missing = (point.flags & 1) !== 0
  const quantiles = metric.type === 'histogram' ? histogramQuantiles(metric.point) : null
  const buckets = metric.type === 'histogram' ? histogramBuckets(metric.point) : []
  return <div className="mt-3 space-y-4" data-testid="metric-evidence">
    <div className="grid gap-1 text-xs text-muted-foreground">
      <div>Unit: {unit} · {metric.type}{metric.type !== 'gauge' && ` · ${metric.aggregationTemporality === 2 ? 'cumulative checkpoint' : 'delta interval'}`}</div>
      <div>Source interval start (Unix ns): {point.startTimeUnixNano === '0' ? 'unspecified (0)' : point.startTimeUnixNano}</div>
      <div>Source point time (Unix ns): {point.timeUnixNano}</div>
    </div>
    {missing && <p role="status">No recorded value (source flag). Raw fields below are retained; they are not a measured zero.</p>}
    {metric.type !== 'histogram' && !missing && <p>Value: {metricValue(metric.point.asInt ?? metric.point.asDouble)} {unit}</p>}
    {metric.type === 'histogram' && <>
      <p className="text-xs">Count: {metric.point.count} · Sum: {metricValue(metric.point.sum)} · Min: {metricValue(metric.point.min)} · Max: {metricValue(metric.point.max)} · Values in {unit}.</p>
      {!missing && metric.point.count === '0' && <p className="text-xs">Empty distribution: no samples, quantiles unavailable.</p>}
      {buckets.length === 0 && <p className="text-xs">Bucket distribution not supplied. Count/sum alone do not determine quantiles.</p>}
      {buckets.length > 0 && <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs" data-testid="histogram-buckets"><caption className="pb-2 text-left text-muted-foreground">Source bucket counts · lower bound excluded, upper bound included · bar width relative to largest bucket{missing && ' · source flagged no recorded value'}</caption><thead><tr><th className="p-2 font-medium">Interval ({unit})</th><th className="p-2 font-medium">Count</th><th className="w-1/3 p-2 font-medium">Relative count</th></tr></thead><tbody>{buckets.map((bucket, i) => <tr className="border-t" key={i}><td className="p-2 font-mono">{bucket.interval}</td><td className="p-2 font-mono">{bucket.count}</td><td className="p-2"><div className="h-2 rounded bg-muted"><div className="h-full rounded bg-signal/70" style={{ width: `${bucket.widthPct}%` }} /></div></td></tr>)}</tbody></table></div>}
      {quantiles && <div className="overflow-auto"><table className="w-full text-left text-xs" data-testid="histogram-quantiles"><caption className="pb-2 text-left text-muted-foreground">Approximate quantiles for this point only, in {unit}. Bounds use the containing bucket and source min/max when available. Unbounded buckets have no estimate.</caption><thead><tr>{['Quantile', 'Estimate', 'Lower bound', 'Upper bound'].map((name) => <th key={name} className="p-2 font-medium">{name}</th>)}</tr></thead><tbody>{Object.entries(quantiles).map(([name, q]) => <tr key={name} className="border-t"><td className="p-2">{name}</td><td className="p-2 font-mono">{metricValue(q.estimate ?? undefined)}</td><td className="p-2 font-mono">{q.lowerBound === null ? '−∞' : q.lowerBound}</td><td className="p-2 font-mono">{q.upperBound === null ? '+∞' : q.upperBound}</td></tr>)}</tbody></table></div>}
    </>}
    <section className="space-y-2">
      <h4 className="font-medium">Exemplars · {point.exemplars.length}</h4>
      <p className="text-xs text-muted-foreground">Exemplars are selected observations, not the full sample population. Links look only in this run; the trace or span may be absent from the capture.</p>
      {point.exemplars.map((exemplar, i) => {
        const target = exemplarTarget(exemplar)
        return <div key={i} className="space-y-2 rounded border p-3 text-xs" data-testid="metric-exemplar">
          <p>Value: {metricValue(exemplar.asInt ?? exemplar.asDouble)} {unit} · Unix ns: {exemplar.timeUnixNano}</p>
          {target ? <Link to="/performance" hash="run-timeline" search={(prev) => ({ ...prev, run: runId, ...target })} className="text-signal hover:underline">Open exemplar {target.span ? 'span' : 'trace'} · {target.trace}{target.span && ` / ${target.span}`}</Link> : <p>No trace reference available for this exemplar.</p>}
          <details><summary className="cursor-pointer">Exemplar attributes and source reference</summary><pre className="mt-2 max-h-64 overflow-auto bg-muted p-3">{JSON.stringify(exemplar, null, 2)}</pre></details>
        </div>
      })}
    </section>
    <details><summary className="cursor-pointer text-xs">Raw metric point, resource and scope</summary><pre className="mt-3 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(metric, null, 2)}</pre></details>
  </div>
}
