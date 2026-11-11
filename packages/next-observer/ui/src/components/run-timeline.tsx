import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type NormalizedSpan } from '@/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { layoutRunTimeline, timelineDuration, type RunTimelineEvent } from '@/lib/run-timeline'
import { performanceNumber } from '@/lib/performance'

export function RunTimelineCard({ runId, traceId, spanId, onChoose }: { runId: string; traceId?: string; spanId?: string; onChoose: (trace: string) => void }) {
  const [offset, setOffset] = useState(0)
  const index = useQuery({ queryKey: ['run-timeline', runId, 'index', offset], queryFn: () => api.performanceTraceList(runId, offset) })
  const detail = useQuery({ queryKey: ['run-timeline', runId, traceId], queryFn: () => api.performanceTrace(runId, traceId!), enabled: Boolean(traceId) })
  const list = index.isError ? undefined : index.data
  return <Card id="run-timeline" className="scroll-mt-20 gap-4 p-5">
    <h3 className="font-medium">Interaction timeline</h3>
    <p className="text-xs text-muted-foreground">Recorded Unix timestamps; clock alignment between sources is unverified. Parentage does not establish blocking or a critical path. Commit events are points; Profiler durations remain event attributes.</p>
    {index.isError && <p role="alert">Could not verify the run trace index.</p>}
    {list?.total === 0 && <p className="text-sm text-muted-foreground">No traces captured in this run. External samples may still be available above.</p>}
    {list && list.total > 0 && <>
      <label className="grid gap-1 text-sm">Interaction / trace<select aria-label="Interaction / trace" className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" value={traceId ?? ''} onChange={(e) => onChoose(e.target.value)}>
        <option value="">Select a trace</option>
        {traceId && !list.traces.some((t) => t.traceId === traceId) && <option value={traceId}>{traceId} · outside this index page</option>}
        {list.traces.map((t) => <option key={t.traceId} value={t.traceId}>{t.name} · {t.traceId} · {t.spanCount} spans</option>)}
      </select></label>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(0)}>First traces</Button><span>{offset + 1}–{offset + list.traces.length} of {list.total} traces (including warmup)</span><Button variant="outline" disabled={list.nextOffset === null} onClick={() => setOffset(list.nextOffset!)}>Next traces</Button></div>
    </>}
    {detail.isLoading && <p className="text-sm">Loading trace…</p>}
    {detail.isError && <p role="alert">Could not verify the selected trace in this run.</p>}
    {traceId && detail.data && !detail.isError && <>
      {detail.data.truncated && <p role="alert">Partial view: {detail.data.spans.length} of {detail.data.totalSpans} spans, bounded to 2,000 spans / 16 MiB. Parents outside this view may be present in the archive.</p>}
      {spanId && !detail.data.spans.some((s) => s.spanId === spanId) && <p role="status">Requested span {spanId} is not in this trace view. It may be absent from the capture or outside the bounded response.</p>}
      <Timeline key={`${traceId}:${spanId ?? ''}`} spans={detail.data.spans} targetSpanId={spanId} />
    </>}
  </Card>
}
function Timeline({ spans, targetSpanId }: { spans: NormalizedSpan[]; targetSpanId?: string }) {
  const layout = useMemo(() => layoutRunTimeline(spans), [spans])
  const [selected, setSelected] = useState<{ span: NormalizedSpan; event?: RunTimelineEvent } | null>(() => { const span = spans.find((s) => s.spanId === targetSpanId); return span ? { span } : null })
  return <div className="space-y-4" data-testid="run-timeline">
    <p className="text-xs text-muted-foreground">Axis: {performanceNumber(layout.durationMs)} ms · {layout.precision === 'exact-nanoseconds' ? 'source nanoseconds, subtracted before conversion' : 'legacy millisecond projection; exact nanoseconds unavailable'}. Zero-duration spans use a point marker.</p>
    {(layout.missingParents > 0 || layout.cycleCount > 0 || layout.duplicateCount > 0 || layout.eventsOutsideSpan > 0) && <p role="alert" className="text-xs">Visible data: {layout.missingParents} missing parents · {layout.cycleCount} cyclic edges · {layout.duplicateCount} duplicate identities · {layout.eventsOutsideSpan} events outside span intervals.</p>}
    <ol className="space-y-1">{layout.rows.map((row) => <li key={row.key} className={`grid gap-1 rounded border p-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] ${selected?.span.spanId === row.span.spanId ? 'border-signal' : ''}`} data-testid="timeline-row">
      <button className="text-left break-all hover:underline" style={{ paddingLeft: Math.min(row.depth, 12) * 10 }} onClick={() => setSelected({ span: row.span })}>{row.depth > 12 && `Depth ${row.depth} · `}{row.span.name} · {timelineDuration(row.span)} · {row.span.service}</button>
      <div className="relative min-h-7 bg-muted/50" style={{ height: 28 + row.events.length * 18 }}>
        <button aria-label={`Span ${row.span.name}`} title={`${row.span.name}: ${timelineDuration(row.span)}`} className="absolute top-2 h-3 min-w-px rounded bg-signal/70 focus:outline-2" style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%` }} onClick={() => setSelected({ span: row.span })} />
        {row.events.map((event, i) => <button key={i} aria-label={`Event ${event.event.name} on ${row.span.name}`} title={`${event.event.name}: ${performanceNumber(event.offsetMs)} ms from axis anchor`} className="absolute z-10 h-4 w-2 -translate-x-1/2 rounded border border-background bg-warning focus:outline-2" style={{ left: `${event.offsetPct}%`, top: 22 + i * 18 }} onClick={() => setSelected({ span: row.span, event })} data-testid="timeline-event" />)}
      </div>
    </li>)}</ol>
    {selected && <div className="space-y-2 rounded border p-3" data-testid="timeline-selection">
      <h4 className="font-medium">{selected.event ? `Event: ${selected.event.event.name}` : `Span: ${selected.span.name}`}</h4>
      {selected.event && <p className="text-xs">Source Unix ns: {selected.event.exactUnixNano ?? 'unavailable (millisecond projection)'} · {performanceNumber(selected.event.offsetMs)} ms relative to axis anchor.</p>}
      <pre className="max-h-96 overflow-auto bg-muted p-3 text-xs">{JSON.stringify(selected.event ? { event: selected.event.event, traceId: selected.span.traceId, spanId: selected.span.spanId } : selected.span, null, 2)}</pre>
    </div>}
  </div>
}
