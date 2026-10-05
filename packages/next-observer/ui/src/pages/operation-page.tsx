import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { api } from '@/api'
import { DurationChart, RequestsChart } from '@/components/dashboard/charts'
import { LatencyHistogram } from '@/components/dashboard/histogram'
import { Change, Legend, Panel, Stat, TimeAxis } from '@/components/dashboard/panel'
import { DetailRow } from '@/components/detail-row'
import { PageHeader } from '@/components/page-header'
import { TracesTable } from '@/components/traces-table'
import { DEFAULT_WINDOW, WINDOWS, WindowPicker } from '@/components/window-picker'
import { formatDuration } from '@/lib/waterfall'

const REFRESH_MS = 2000
const operationRoute = getRouteApi('/operation')
const pct = (n: number) => `${Math.round(n * 100)}%`
const dash = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : formatDuration(ms))

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

export function OperationPage() {
  const { name, service, window = DEFAULT_WINDOW } = operationRoute.useSearch()
  const navigate = useNavigate({ from: '/operation' })
  const details = useQuery({ queryKey: ['operation', name, service, window], queryFn: () => api.operation(name, WINDOWS[window], service), refetchInterval: REFRESH_MS, enabled: name !== '' })
  const d = details.data
  // The list below shows the same window as the numbers above.
  const traces = useQuery({
    queryKey: ['operation-traces', name, service, window],
    queryFn: () => api.traces({ operation: name, service, fromMs: Date.now() - WINDOWS[window], limit: 50 }),
    refetchInterval: REFRESH_MS,
    enabled: name !== '',
  })

  if (name === '') return <p className="text-muted-foreground">No operation selected — pick one on the Overview.</p>
  const o = d?.overview

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">
          ← overview
        </Link>
        <PageHeader title={<span className="font-mono text-xl">{name}</span>} subtitle={d?.service ? `One operation of ${d.service} — its traffic, latency and every call.` : 'One operation — its traffic, latency and every call.'}>
          <WindowPicker value={window} onChange={(key) => navigate({ search: (prev) => ({ ...prev, window: key }), replace: true })} />
        </PageHeader>
      </div>

      {!d || !o ? (
        <p className="text-muted-foreground">{details.isError ? 'The observer is not reachable.' : 'Loading…'}</p>
      ) : o.requests.total === 0 ? (
        <p className="text-muted-foreground" data-testid="operation-empty">
          No calls of this operation in the last {window}. Try a longer window.
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Details" testId="panel-details">
              <dl>
                <DetailRow label="Calls">{o.requests.total}</DetailRow>
                <DetailRow label="Avg duration">{dash(o.duration.avgMs)}</DetailRow>
                <DetailRow label="Median">{dash(d.histogram?.p50Ms)}</DetailRow>
                <DetailRow label="95th percentile">{dash(o.duration.p95Ms)}</DetailRow>
                <DetailRow label="Errors">
                  <span className={o.errors.count ? 'text-destructive' : ''}>
                    {o.errors.count} ({pct(o.errors.rate)})
                  </span>
                </DetailRow>
                {d.coldStarts > 0 && <DetailRow label="Cold starts (not in latency)">{d.coldStarts}</DetailRow>}
                <DetailRow label="Last call">{d.lastSeenMs === null ? '—' : ago(d.lastSeenMs)}</DetailRow>
              </dl>
              {d.versions.length > 1 && (
                <table className="mt-4 w-full font-mono text-xs" data-testid="versions">
                  <thead>
                    <tr className="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
                      <th className="py-1 font-normal">Version</th>
                      <th className="py-1 text-right font-normal">Calls</th>
                      <th className="py-1 text-right font-normal">Median</th>
                      <th className="py-1 text-right font-normal">P95</th>
                      <th className="py-1 text-right font-normal">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.versions.map((v) => (
                      <tr key={v.version} className="border-t tabular-nums">
                        <td className="py-1.5">{v.version}</td>
                        <td className="py-1.5 text-right">{v.count}</td>
                        <td className="py-1.5 text-right">{formatDuration(v.p50Ms)}</td>
                        <td className="py-1.5 text-right">{formatDuration(v.p95Ms)}</td>
                        <td className={`py-1.5 text-right ${v.errorRate > 0 ? 'text-destructive' : ''}`}>{pct(v.errorRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel title="Latency distribution" testId="panel-distribution" aside={d.histogram ? `${d.histogram.total} calls` : undefined}>
              {d.histogram ? <LatencyHistogram histogram={d.histogram} speeds={d.speeds} /> : <p className="py-6 text-center text-sm text-muted-foreground">Only cold starts so far — no representative latency yet.</p>}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Calls"
              testId="panel-requests"
              count={o.requests.total}
              change={<Change value={o.requests.change} />}
              aside={
                <>
                  <Legend tone="bg-foreground/40">ok</Legend>
                  <Legend tone="bg-warning">4xx</Legend>
                  <Legend tone="bg-destructive">failed</Legend>
                </>
              }
            >
              <RequestsChart series={o.requests.series} />
              <TimeAxis fromMs={o.fromMs} toMs={o.toMs} />
            </Panel>
            <Panel
              title="Duration"
              testId="panel-duration"
              change={<Change value={o.duration.change} upIsBad />}
              aside={
                <>
                  <Stat label="AVG">{dash(o.duration.avgMs)}</Stat>
                  <Stat label="P95">{dash(o.duration.p95Ms)}</Stat>
                </>
              }
            >
              <DurationChart series={o.duration.series} />
              <TimeAxis fromMs={o.fromMs} toMs={o.toMs} />
            </Panel>
          </div>

          <div className="space-y-3">
            <h2 className="font-medium">Traces with this operation</h2>
            <TracesTable traces={traces.data} empty="No traces in this window." />
          </div>
        </>
      )}
    </div>
  )
}
