import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { api, type Defect } from '@/api'
import { CopyPrompt } from '@/components/copy-prompt'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DEFAULT_WINDOW, WINDOWS, WindowPicker } from '@/components/window-picker'
import { defectPrompt } from '@/lib/agent-prompt'
import { affectedBy, questionFor } from '@/lib/defects'

const REFRESH_MS = 2000
const errorsRoute = getRouteApi('/errors')

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

export function ErrorsPage() {
  const { window = DEFAULT_WINDOW, service } = errorsRoute.useSearch()
  const navigate = useNavigate({ from: '/errors' })
  const defects = useQuery({ queryKey: ['defects', window, service], queryFn: () => api.defects(WINDOWS[window], service), refetchInterval: REFRESH_MS })

  return (
    <div className="space-y-6">
      <PageHeader title="Errors" count={defects.data?.length} subtitle="Failures grouped by where they start and what they say — one entry per defect, not per request.">
        <WindowPicker value={window} onChange={(key) => navigate({ search: (prev) => ({ ...prev, window: key }), replace: true })} />
      </PageHeader>

      {!defects.data ? (
        <p className="text-muted-foreground">{defects.isError ? 'The observer is not reachable.' : 'Loading…'}</p>
      ) : defects.data.length === 0 ? (
        <Card className="items-center py-12 text-center" data-testid="errors-empty">
          <p className="font-medium">No errors in the last {window}</p>
          <p className="text-sm text-muted-foreground">A defect shows up here as soon as a span fails.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {defects.data.map((d) => (
            <DefectCard key={d.id} defect={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DefectCard({ defect: d }: { defect: Defect }) {
  const navigate = useNavigate()
  const peak = Math.max(1, ...d.series)
  // The browser's request to a failing route reads the same as the route: "in GET /api/x · fails GET /api/x" says nothing.
  const affected = affectedBy(d)
  return (
    <Card className="gap-0 py-0" data-testid="defect" data-new={d.isNew ? 'true' : undefined}>
      <div className="grid gap-x-6 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {d.isNew ? (
              <span className="rounded-md bg-warning/15 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-warning uppercase" data-testid="defect-new">
                new in {d.firstSeenVersion}
              </span>
            ) : (
              d.versions.length > 0 && <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">seen in {d.versions.join(', ')}</span>
            )}
            <span
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] tracking-wider uppercase ${d.source === 'browser' ? 'border-signal/40 text-signal' : 'text-muted-foreground'}`}
              data-testid="defect-source"
            >
              {d.source}
            </span>
            {d.type && <span className="font-mono text-xs text-muted-foreground">{d.type}</span>}
          </div>
          {/* pre-wrap: a hydration mismatch comes as a small tree — the element and the two values on their own lines. */}
          <p className="font-mono text-sm break-words whitespace-pre-wrap text-destructive" data-testid="defect-message">
            {d.message}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="defect-where">
            {d.category === 'code' ? (
              <>
                in{' '}
                <Link to="/operation" search={{ name: d.spanName, service: d.service }} className="font-mono text-foreground underline decoration-dotted underline-offset-4 hover:text-signal">
                  {d.operation}
                </Link>
              </>
            ) : (
              // A kind of browser error or a request path is not an operation with a page of its own.
              <span className="font-mono text-foreground">{d.operation}</span>
            )}
            {d.pages.length > 0 && (
              <>
                {' '}
                · on{' '}
                {d.pages.map((p, i) => (
                  <span key={p.path}>
                    {i > 0 && ', '}
                    <span className="font-mono text-foreground">{p.path}</span>
                  </span>
                ))}
              </>
            )}
            {affected.length > 0 && (
              <>
                {' '}
                · fails{' '}
                {affected.map((a, i) => (
                  <span key={`${a.service}:${a.spanName}:${a.operation}`}>
                    {i > 0 && ', '}
                    {a.spanName === a.operation ? (
                      <Link to="/operation" search={{ name: a.spanName, service: a.service }} className="font-mono text-foreground hover:text-signal">
                        {a.operation}
                      </Link>
                    ) : (
                      <span className="font-mono text-foreground">{a.operation}</span>
                    )}
                  </span>
                ))}
              </>
            )}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-medium tabular-nums" data-testid="defect-count">
              {d.count}
            </span>
            <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{d.count === 1 ? 'occurrence' : 'occurrences'}</span>
          </div>
          <div className="flex h-8 items-end gap-0.5" aria-hidden>
            {d.series.map((n, i) => (
              <span key={i} className={`flex-1 rounded-[2px] ${n ? 'bg-destructive' : 'bg-foreground/10'}`} style={{ height: n ? `${Math.max((n / peak) * 100, 12)}%` : '2px' }} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-5 py-2.5 font-mono text-xs text-muted-foreground">
        <span>first seen {ago(d.firstSeenMs)}</span>
        <span>last seen {ago(d.lastSeenMs)}</span>
        <span className="flex items-center gap-2">
          traces
          {d.exampleTraceIds.map((id) => (
            <Link key={id} to="/traces/$traceId" params={{ traceId: id }} className="text-signal underline-offset-2 hover:underline">
              {id.slice(0, 6)}…{id.slice(-4)}
            </Link>
          ))}
        </span>
        <CopyPrompt build={() => defectPrompt(d)} className="ml-auto font-sans" />
        <Button type="button" size="sm" variant="outline" className="font-sans" data-testid="defect-investigate" onClick={() => void navigate({ to: '/chat', search: { ask: questionFor(d) } })}>
          Investigate
        </Button>
      </div>
    </Card>
  )
}
