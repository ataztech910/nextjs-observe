import { useQuery } from '@tanstack/react-query'
import { spanLabel } from '../../../src/collector/span-label'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { api, type Histogram, type NormalizedSpan, type TraceSpan } from '@/api'
import { ColdStartBadge } from '@/components/cold-start-badge'
import { CopyPrompt } from '@/components/copy-prompt'
import { DetailRow } from '@/components/detail-row'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Panel } from '@/components/dashboard/panel'
import { tracePrompt } from '@/lib/agent-prompt'
import { criticalPath, rootSpan, selfTimes, standing, timeByOperation } from '@/lib/trace-analysis'
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
  const [showCritical, setShowCritical] = useState(false)
  const spans = trace.data?.spans
  const critical = useMemo(() => criticalPath(spans ?? []), [spans])
  const self = useMemo(() => selfTimes(spans ?? []), [spans])
  const byOperation = useMemo(() => timeByOperation(spans ?? []), [spans])
  // The same root the critical path starts from. How that request usually behaves: the hour around this call (by the
  // collector's clock — the trace's own timestamps), so a trace opened a day later is judged against its own time.
  const root = useMemo(() => rootSpan(spans ?? []), [spans])
  const others = useQuery({
    queryKey: ['trace-operation', root?.service, root?.name, root?.startTimeMs],
    queryFn: () => api.operation(root!.name, COMPARE_WINDOW_MS, root!.service, root!.startTimeMs + COMPARE_WINDOW_MS / 2),
    enabled: root !== undefined,
  })

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
        >
          <CopyPrompt
            build={() => {
              const h = others.data?.histogram
              return tracePrompt({ traceId, spans: trace.data.spans, usual: h && h.total >= MIN_CALLS_TO_COMPARE ? { p50Ms: h.p50Ms, p95Ms: h.p95Ms, calls: h.total } : undefined })
            }}
          />
        </PageHeader>
      </div>

      {root && others.data?.histogram && others.data.histogram.total >= MIN_CALLS_TO_COMPARE && (
        <ComparedToOthers durationMs={root.durationMs} histogram={others.data.histogram} operation={root.name} service={root.service} coldStart={root.coldStart === true} />
      )}

      <div className="grid grid-cols-[1fr_380px] gap-4">
        <Card className="gap-0 self-start py-0">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
            <button
              type="button"
              aria-pressed={showCritical}
              data-testid="critical-path-toggle"
              onClick={() => setShowCritical((on) => !on)}
              className="rounded-full border px-3 py-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase hover:text-foreground aria-pressed:border-warning/60 aria-pressed:bg-warning/10 aria-pressed:text-warning"
            >
              Critical path
            </button>
            <span className="font-mono text-xs text-muted-foreground">
              {showCritical ? 'The spans that decided the duration — values show their own time.' : 'Highlight the spans that decided the duration.'}
            </span>
          </div>
          <div role="tree" aria-label="Waterfall">
            {layout.rows.map(({ span, depth, offsetPct, widthPct }) => (
              <button
                key={span.spanId}
                type="button"
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={span.spanId === selected?.spanId}
                data-span-name={span.name}
                data-critical={critical.has(span.spanId) ? 'true' : undefined}
                onClick={() => setSelectedId(span.spanId)}
                className={`grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b px-4 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 aria-selected:bg-muted ${showCritical && !critical.has(span.spanId) ? 'opacity-30' : ''}`}
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
                <span className={`text-right font-mono text-xs tabular-nums ${showCritical ? 'text-warning' : 'text-muted-foreground'}`}>
                  {formatDuration(showCritical ? (self.get(span.spanId) ?? 0) : span.durationMs)}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {selected && <SpanDetails span={selected} selfMs={self.get(selected.spanId)} />}
      </div>

      <Panel title="Where the time went" testId="panel-self-time" aside="own time, without calls to others · % of all own time">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
              <th className="pb-2 font-normal">Operation</th>
              <th className="w-1/4 pb-2 font-normal">Self %</th>
              <th className="pb-2 text-right font-normal">Self</th>
              <th className="pb-2 text-right font-normal">Total</th>
              <th className="pb-2 text-right font-normal">Calls</th>
            </tr>
          </thead>
          <tbody>
            {byOperation.map((r) => (
              <tr key={`${r.service}:${r.name}`} className="border-t" data-testid="self-time-row">
                <td className="max-w-0 truncate py-2 pr-3 font-mono">
                  <Link to="/operation" search={{ name: r.name, service: r.service }} className="hover:text-signal">
                    {r.name}
                  </Link>
                  {services.length > 1 && <span className="ml-2 font-sans text-xs text-muted-foreground">{r.service}</span>}
                </td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-muted">
                      <span className="block h-1.5 rounded-full bg-warning/80" style={{ width: `${r.selfShare * 100}%` }} />
                    </span>
                    <span className="w-10 text-right font-mono text-xs text-muted-foreground tabular-nums">{Math.round(r.selfShare * 100)}%</span>
                  </span>
                </td>
                <td className="py-2 text-right font-mono tabular-nums">{formatDuration(r.selfMs)}</td>
                <td className="py-2 text-right font-mono text-muted-foreground tabular-nums">{formatDuration(r.totalMs)}</td>
                <td className="py-2 text-right font-mono text-muted-foreground tabular-nums">{r.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

const MIN_CALLS_TO_COMPARE = 5
const COMPARE_WINDOW_MS = 60 * 60_000

const STANDING = {
  slow: { text: 'slower than 95% of the calls', tone: 'text-warning', dot: 'bg-warning' },
  typical: { text: 'a typical call', tone: 'text-signal', dot: 'bg-signal' },
  fast: { text: 'faster than half of the calls', tone: 'text-signal', dot: 'bg-signal' },
}
const COLD = { text: 'a cold start', tone: 'text-muted-foreground', dot: 'bg-muted-foreground' }

/** This call on the scale of the others: median and p95 as ticks, the call as a dot, the verdict in words. */
function ComparedToOthers({ durationMs, histogram, operation, service, coldStart }: { durationMs: number; histogram: Histogram; operation: string; service: string; coldStart: boolean }) {
  // The others are warm calls only (cold starts are left out of the distribution), so a cold start gets no verdict.
  const verdict = coldStart ? COLD : STANDING[standing(durationMs, histogram)]
  const max = Math.max(histogram.p99Ms, durationMs) * 1.05 || 1
  const at = (ms: number) => `${Math.min((ms / max) * 100, 100)}%`
  return (
    <Panel
      title="Compared to other calls"
      testId="panel-compared"
      aside={
        <Link to="/operation" search={{ name: operation, service }} className="hover:text-signal">
          {histogram.total} calls · the hour around this one →
        </Link>
      }
    >
      <div className="relative mt-5 mb-9 h-1.5 rounded-full bg-muted">
        {[
          { label: 'median', ms: histogram.p50Ms },
          { label: 'p95', ms: histogram.p95Ms },
        ].map((m) => (
          <span key={m.label} className="absolute -top-5 h-8 border-l border-dashed border-foreground/30" style={{ left: at(m.ms) }}>
            <span className={`absolute -top-0.5 font-mono text-[10px] tracking-wider whitespace-nowrap text-muted-foreground uppercase ${m.ms / max > 0.75 ? 'right-1.5' : 'left-1.5'}`}>
              {m.label} {formatDuration(m.ms)}
            </span>
          </span>
        ))}
        <span className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-background ${verdict.dot}`} style={{ left: at(durationMs) }} data-testid="this-call" />
        <span className={`absolute top-4 -translate-x-1/2 font-mono text-xs whitespace-nowrap ${verdict.tone}`} style={{ left: `clamp(3rem, ${at(durationMs)}, calc(100% - 3rem))` }}>
          {formatDuration(durationMs)} · this call
        </span>
      </div>
      <p className="text-sm" data-testid="standing">
        <span className={verdict.tone}>{verdict.text[0].toUpperCase() + verdict.text.slice(1)}</span>
        <span className="text-muted-foreground">
          {' '}
          — {coldStart ? 'it includes compiling the route, so it is not judged against the warm calls.' : `${(durationMs / (histogram.p50Ms || 1)).toFixed(1)}× the median.`}
        </span>
      </p>
    </Panel>
  )
}

function SpanDetails({ span, selfMs }: { span: NormalizedSpan; selfMs?: number }) {
  const rows: [string, unknown][] = [
    ['service', span.serviceVersion ? `${span.service}@${span.serviceVersion}` : span.service],
    ['kind', span.kind],
    ['duration', formatDuration(span.durationMs)],
    ...(selfMs === undefined ? [] : ([['own time', formatDuration(selfMs)]] as [string, unknown][])),
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
        <Link to="/operation" search={{ name: span.name, service: span.service }} className="font-mono text-xs text-signal underline-offset-2 hover:underline" data-testid="operation-link">
          all calls of this operation →
        </Link>
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
