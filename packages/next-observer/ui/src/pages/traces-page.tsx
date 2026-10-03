import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { api, type TraceSearch } from '@/api'
import { Badge } from '@/components/ui/badge'
import { ColdStartBadge } from '@/components/cold-start-badge'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDuration } from '@/lib/waterfall'

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

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Trace</TableHead>
              <TableHead>Services</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Spans</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="pr-4 text-right">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {traces.data?.map((t) => (
              <TableRow key={t.traceId} data-testid="trace-row">
                <TableCell className="pl-4">
                  <Link to="/traces/$traceId" params={{ traceId: t.traceId }} className="font-medium hover:underline">
                    {t.rootName}
                  </Link>
                  {t.coldStart && <ColdStartBadge />}
                  <div className="font-mono text-xs text-muted-foreground">{t.traceId.slice(0, 16)}</div>
                </TableCell>
                <TableCell className="space-x-1">
                  {t.services.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatDuration(t.durationMs)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{t.spanCount}</TableCell>
                <TableCell className="text-right">{t.errorCount > 0 ? <Badge variant="destructive">{t.errorCount}</Badge> : '—'}</TableCell>
                <TableCell className="pr-4 text-right font-mono text-xs text-muted-foreground tabular-nums">{new Date(t.startTimeMs).toLocaleTimeString()}</TableCell>
              </TableRow>
            ))}
            {traces.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No traces yet — open your app while <code>next-observer dev</code> is running.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
