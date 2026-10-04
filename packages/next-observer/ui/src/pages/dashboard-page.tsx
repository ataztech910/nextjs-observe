import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { api } from '@/api'
import { DurationChart, RequestsChart, RouteList } from '@/components/dashboard/charts'
import { Change, Legend, Panel, Stat, TimeAxis } from '@/components/dashboard/panel'
import { PageHeader } from '@/components/page-header'
import { formatDuration } from '@/lib/waterfall'

export const WINDOWS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 } as const
export type WindowKey = keyof typeof WINDOWS

const REFRESH_MS = 2000
const dashboardRoute = getRouteApi('/')
const pct = (n: number) => `${Math.round(n * 100)}%`

export function DashboardPage() {
  const { window = '15m', service } = dashboardRoute.useSearch()
  const navigate = useNavigate({ from: '/' })
  const overview = useQuery({ queryKey: ['overview', window, service], queryFn: () => api.overview(WINDOWS[window], service), refetchInterval: REFRESH_MS })
  const services = useQuery({ queryKey: ['services'], queryFn: api.services, refetchInterval: REFRESH_MS })
  const o = overview.data

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Your app's requests, latency and errors — compared with the period before.">
        <select
          aria-label="Service"
          className="h-8 rounded-md border bg-card px-2 text-sm"
          value={service ?? ''}
          onChange={(e) => navigate({ search: (prev) => ({ ...prev, service: e.target.value || undefined }), replace: true })}
        >
          <option value="">All services</option>
          {services.data
            ?.filter((s) => !s.name.endsWith('-browser'))
            .map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
        </select>
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Time window">
          {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === window}
              onClick={() => navigate({ search: (prev) => ({ ...prev, window: key === '15m' ? undefined : key }), replace: true })}
              className="border-l px-3 py-1 font-mono text-xs text-muted-foreground uppercase first:border-l-0 hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {key}
            </button>
          ))}
        </div>
      </PageHeader>

      {!o ? (
        <p className="text-muted-foreground">{overview.isError ? 'The observer is not reachable.' : 'Loading…'}</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Requests"
              testId="panel-requests"
              count={o.requests.total}
              change={<Change value={o.requests.change} />}
              aside={
                <>
                  <span className="tabular-nums">{o.requests.perSecond}/s</span>
                  <Legend tone="bg-foreground/40">2/3xx</Legend>
                  <Legend tone="bg-warning">4xx</Legend>
                  <Legend tone="bg-destructive">5xx</Legend>
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
                  <Stat label="AVG">{o.duration.avgMs === null ? '—' : formatDuration(o.duration.avgMs)}</Stat>
                  <Stat label="P95">{o.duration.p95Ms === null ? '—' : formatDuration(o.duration.p95Ms)}</Stat>
                </>
              }
            >
              <DurationChart series={o.duration.series} />
              <TimeAxis fromMs={o.fromMs} toMs={o.toMs} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Errors" testId="panel-errors" count={o.errors.count} change={<Change value={o.errors.change} upIsBad />}>
              <div className="space-y-1">
                <div className={`font-mono text-4xl font-medium tabular-nums ${o.errors.count > 0 ? 'text-destructive' : ''}`} data-testid="error-rate">
                  {pct(o.errors.rate)}
                </div>
                <p className="text-sm text-muted-foreground">of requests failed with 5xx</p>
              </div>
              <div className="mt-4 flex h-12 items-end gap-0.5" aria-hidden>
                {o.requests.series.map((b) => {
                  const max = Math.max(1, ...o.requests.series.map((x) => x.serverErrors))
                  return <span key={b.startMs} className={`flex-1 rounded-[2px] ${b.serverErrors ? 'bg-destructive' : 'bg-foreground/10'}`} style={{ height: b.serverErrors ? `${(b.serverErrors / max) * 100}%` : '2px' }} />
                })}
              </div>
            </Panel>
            <Panel title="Slowest" testId="panel-slowest" aside="P95">
              <RouteList
                rows={o.slowest}
                value={(r) => formatDuration(r.p95Ms)}
                meta={(r) => `${r.count} ${r.count === 1 ? 'call' : 'calls'}${r.errorRate > 0 ? ` · ${pct(r.errorRate)} errors` : ''}${r.coldOnly ? ' · cold start only' : ''}`}
                empty="No requests in this window."
              />
            </Panel>
            <Panel title="Busiest" testId="panel-busiest" aside="CALLS">
              <RouteList rows={o.busiest} value={(r) => String(r.count)} meta={(r) => `${pct(r.share)} of requests`} empty="No requests in this window." />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
