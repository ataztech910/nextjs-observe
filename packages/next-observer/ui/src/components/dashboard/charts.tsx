import { Link } from '@tanstack/react-router'
import type { Overview, RouteRow } from '@/api'
import { formatDuration } from '@/lib/waterfall'

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Stacked bars per time bucket: 2xx/3xx grey, 4xx amber, 5xx red — failures stand out without reading numbers. */
export function RequestsChart({ series }: { series: Overview['requests']['series'] }) {
  const max = Math.max(1, ...series.map((b) => b.ok + b.clientErrors + b.serverErrors))
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Requests over time">
      {series.map((b) => {
        const total = b.ok + b.clientErrors + b.serverErrors
        return (
          <div
            key={b.startMs}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${time(b.startMs)} · ${total} requests · ${b.clientErrors} 4xx · ${b.serverErrors} 5xx`}
            data-testid="requests-bucket"
          >
            {/* Column order is top to bottom: errors sit on top of the successful requests. */}
            <Segment value={b.serverErrors} max={max} tone="bg-destructive" />
            <Segment value={b.clientErrors} max={max} tone="bg-warning" />
            <Segment value={b.ok} max={max} tone="bg-foreground/25" />
            {total === 0 && <span className="h-px bg-foreground/10" />}
          </div>
        )
      })}
    </div>
  )
}

function Segment({ value, max, tone }: { value: number; max: number; tone: string }) {
  if (value === 0) return null
  return <span className={`block min-h-0.5 rounded-[2px] ${tone}`} style={{ height: `${(value / max) * 100}%` }} />
}

/** p95 as an area, the average as a line. Buckets without requests are gaps — no line drawn through silence. */
export function DurationChart({ series }: { series: Overview['duration']['series'] }) {
  const max = Math.max(1, ...series.map((b) => b.p95Ms ?? 0)) * 1.15
  const x = (i: number) => ((i + 0.5) / series.length) * 100
  const y = (ms: number) => 100 - (ms / max) * 100

  // Consecutive buckets with data form one segment.
  const segments: { i: number; avg: number; p95: number }[][] = []
  series.forEach((b, i) => {
    if (b.p95Ms === null || b.avgMs === null) return segments.push([])
    if (segments.length === 0) segments.push([])
    segments[segments.length - 1].push({ i, avg: b.avgMs, p95: b.p95Ms })
  })
  const parts = segments.filter((s) => s.length > 0)

  return (
    <div className="relative h-40">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label="Duration over time">
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2="100" y1={g} y2={g} className="stroke-foreground/10" strokeDasharray="1 1.5" vectorEffect="non-scaling-stroke" />
        ))}
        {parts.map((seg) => {
          const top = seg.map((p) => `${x(p.i)},${y(p.p95)}`)
          // A single bucket would be an invisible zero-width area: widen it to the bucket.
          const pts = seg.length === 1 ? [`${x(seg[0].i) - 50 / series.length},${y(seg[0].p95)}`, `${x(seg[0].i) + 50 / series.length},${y(seg[0].p95)}`] : top
          const first = pts[0].split(',')[0]
          const last = pts[pts.length - 1].split(',')[0]
          return (
            <g key={seg[0].i}>
              <polygon points={`${first},100 ${pts.join(' ')} ${last},100`} className="fill-chart-1/15" />
              <polyline points={pts.join(' ')} fill="none" className="stroke-chart-1" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline
                points={seg.length === 1 ? pts.map((p) => `${p.split(',')[0]},${y(seg[0].avg)}`).join(' ') : seg.map((p) => `${x(p.i)},${y(p.avg)}`).join(' ')}
                fill="none"
                className="stroke-foreground/50"
                strokeWidth="1"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
      <span className="absolute top-0 left-0 font-mono text-[11px] text-muted-foreground">{formatDuration(max)}</span>
    </div>
  )
}

/** A route list: the operation in mono, its number on the right, context underneath. Click → its traces. */
export function RouteList({ rows, value, meta, empty }: { rows: RouteRow[]; value: (r: RouteRow) => string; meta: (r: RouteRow) => string; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="-my-1 divide-y">
      {rows.map((r) => {
        const [method, ...rest] = r.operation.split(' ')
        const hasMethod = rest.length > 0 && /^[A-Z]+$/.test(method)
        return (
          <li key={`${r.service}:${r.operation}`}>
            <Link to="/traces" search={{ operation: r.operation }} className="group flex items-center gap-3 py-2.5" data-testid="route-row">
              {hasMethod && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">{method}</span>}
              <span className="min-w-0 flex-1 truncate font-mono text-sm group-hover:text-signal">{hasMethod ? rest.join(' ') : r.operation}</span>
              <span className="text-right">
                <span className="block font-mono text-sm tabular-nums">{value(r)}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{meta(r)}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
