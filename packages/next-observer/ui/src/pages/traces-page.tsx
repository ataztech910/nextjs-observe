import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { api, type TraceSearch } from '@/api'
import { PageHeader } from '@/components/page-header'
import { TracesTable } from '@/components/traces-table'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

const LIVE_REFRESH_MS = 2000
const tracesRoute = getRouteApi('/traces')

export function TracesPage() {
  const search = tracesRoute.useSearch()
  const navigate = useNavigate({ from: '/traces' })
  const setSearch = (patch: Partial<TraceSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const traces = useQuery({ queryKey: ['traces', search], queryFn: () => api.traces(search), refetchInterval: LIVE_REFRESH_MS })
  const services = useQuery({ queryKey: ['services'], queryFn: api.services, refetchInterval: LIVE_REFRESH_MS })

  return (
    <div className="space-y-6">
      <PageHeader title="Traces" count={traces.data?.length} subtitle="Every request your app made — server and browser, live." />

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Service"
          className="h-9 rounded-md border bg-card px-2 text-sm"
          value={search.service ?? ''}
          onChange={(e) => setSearch({ service: e.target.value || undefined })}
        >
          <option value="">All services</option>
          {services.data?.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.versions.length ? ` (${s.versions.join(', ')})` : ''}
            </option>
          ))}
        </select>
        <Input
          aria-label="Operation"
          className="w-64"
          placeholder="Operation contains…"
          defaultValue={search.operation ?? ''}
          onChange={(e) => setSearch({ operation: e.target.value || undefined })}
        />
        <Input
          aria-label="Min duration (ms)"
          className="w-40"
          type="number"
          min={0}
          placeholder="Min ms"
          defaultValue={search.minDurationMs ?? ''}
          onChange={(e) => setSearch({ minDurationMs: Number(e.target.value) || undefined })}
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={search.hasError ?? false} onCheckedChange={(checked) => setSearch({ hasError: checked || undefined })} />
          Errors only
        </label>
        {traces.isError && <span className="ml-auto font-mono text-xs text-destructive">collector unreachable</span>}
      </div>

      <TracesTable traces={traces.data} empty={<>No traces yet — open your app while <code>next-observer dev</code> is running.</>} />
    </div>
  )
}
