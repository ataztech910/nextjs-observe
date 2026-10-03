import { useQuery } from '@tanstack/react-query'
import { spanLabel } from '../../../src/collector/span-label'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { api, type NormalizedSpan, type TraceSpan } from '@/api'
import { ColdStartBadge } from '@/components/cold-start-badge'
import { DetailRow } from '@/components/detail-row'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { layoutWaterfall, formatDuration } from '@/lib/waterfall'

const traceRoute = getRouteApi('/traces/$traceId')

const SERVICE_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-4', 'bg-chart-3', 'bg-chart-5']

function serviceColor(service: string, services: string[]): string {
  return SERVICE_COLORS[services.indexOf(service) % SERVICE_COLORS.length]
}

export function TracePage() {
  const { traceId } = traceRoute.useParams()
  const trace = useQuery({ queryKey: ['trace', traceId], queryFn: () => api.trace(traceId) })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const layout = useMemo(() => layoutWaterfall(trace.data?.spans ?? []), [trace.data])
  const services = useMemo(() => [...new Set(layout.rows.map((r) => r.span.service))], [layout])
  const selected = layout.rows.find((r) => r.span.spanId === selectedId)?.span ?? layout.rows[0]?.span

  if (trace.isError) return <p className="text-destructive">Trace {traceId} not found.</p>
  if (!trace.data) return <p className="text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/traces" className="font-mono text-xs text-muted-foreground hover:text-foreground">
          ← traces
        </Link>
        <PageHeader
          title={
            <>
              {layout.rows[0] ? spanLabel(layout.rows[0].span) : ''}
              {trace.data.spans.some((s) => s.coldStart) && <ColdStartBadge />}
            </>
          }
          subtitle={
            <>
              <span className="text-foreground tabular-nums">{formatDuration(layout.durationMs)}</span> · {layout.rows.length} spans · {traceId}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-4">
        <Card className="gap-0 self-start py-0" role="tree" aria-label="Waterfall">
          {layout.rows.map(({ span, depth, offsetPct, widthPct }) => (
            <button
              key={span.spanId}
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={span.spanId === selected?.spanId}
              data-span-name={span.name}
              onClick={() => setSelectedId(span.spanId)}
              className="grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b px-4 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 aria-selected:bg-muted"
            >
              <span className="truncate" style={{ paddingLeft: depth * 14 }}>
                <span className={span.status === 'error' ? 'font-medium text-destructive' : ''}>{spanLabel(span)}</span>
                {(span as TraceSpan).coldStart && <ColdStartBadge />}
                <span className="ml-2 text-xs text-muted-foreground">{span.service}</span>
              </span>
              <span className="relative h-2.5">
                <span
                  className={`absolute top-0 h-2.5 min-w-0.5 rounded-full opacity-80 ${span.status === 'error' ? 'bg-destructive' : serviceColor(span.service, services)}`}
                  style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                />
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(span.durationMs)}</span>
            </button>
          ))}
        </Card>

        {selected && <SpanDetails span={selected} />}
      </div>
    </div>
  )
}

function SpanDetails({ span }: { span: NormalizedSpan }) {
  const rows: [string, unknown][] = [
    ['service', span.serviceVersion ? `${span.service}@${span.serviceVersion}` : span.service],
    ['kind', span.kind],
    ['duration', formatDuration(span.durationMs)],
    ['status', span.statusMessage ? `${span.status}: ${span.statusMessage}` : span.status],
    ...Object.entries(span.attributes),
  ]
  return (
    <Card className="self-start" data-testid="span-details">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {spanLabel(span)}
          {span.status === 'error' && <Badge variant="destructive">error</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl>
          {rows.map(([key, value]) => (
            <DetailRow key={key} label={key}>
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </DetailRow>
          ))}
        </dl>
        {span.events.map((event, i) => (
          <div key={i} className="rounded-md bg-muted p-2 text-xs">
            <div className="font-medium">{event.name}</div>
            <pre className="whitespace-pre-wrap break-all">{String(event.attributes['exception.message'] ?? '')}</pre>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
