import { useQuery } from '@tanstack/react-query'
import { spanLabel } from '../../../src/collector/span-label'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { api, type NormalizedSpan, type TraceSpan } from '@/api'
import { ColdStartBadge } from '@/components/cold-start-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { layoutWaterfall, formatDuration } from '@/lib/waterfall'

const traceRoute = getRouteApi('/traces/$traceId')

const SERVICE_COLORS = ['bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-pink-500', 'bg-teal-500']

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
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link to="/traces" className="text-sm text-muted-foreground hover:underline">
          ← Traces
        </Link>
        <h1 className="text-lg font-semibold">
          {layout.rows[0] ? spanLabel(layout.rows[0].span) : ''}
          {trace.data.spans.some((s) => s.coldStart) && <ColdStartBadge />}
        </h1>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDuration(layout.durationMs)} · {layout.rows.length} spans
        </span>
        <span className="font-mono text-xs text-muted-foreground">{traceId}</span>
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-4">
        <div className="overflow-hidden rounded-md border" role="tree" aria-label="Waterfall">
          {layout.rows.map(({ span, depth, offsetPct, widthPct }) => (
            <button
              key={span.spanId}
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={span.spanId === selected?.spanId}
              data-span-name={span.name}
              onClick={() => setSelectedId(span.spanId)}
              className="grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/50 aria-selected:bg-muted"
            >
              <span className="truncate" style={{ paddingLeft: depth * 14 }}>
                <span className={span.status === 'error' ? 'font-medium text-destructive' : ''}>{spanLabel(span)}</span>
                {(span as TraceSpan).coldStart && <ColdStartBadge />}
                <span className="ml-2 text-xs text-muted-foreground">{span.service}</span>
              </span>
              <span className="relative h-4">
                <span
                  className={`absolute top-0 h-4 rounded-sm ${span.status === 'error' ? 'bg-destructive' : serviceColor(span.service, services)}`}
                  style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                />
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">{formatDuration(span.durationMs)}</span>
            </button>
          ))}
        </div>

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
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all font-mono">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
            </div>
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
