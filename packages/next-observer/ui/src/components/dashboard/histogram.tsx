import type { Histogram, Speed } from '@/api'
import { formatDuration } from '@/lib/waterfall'

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * How the latency of one operation is spread. Percentile markers sit on the same axis as the bars; when the calls
 * fall into two separate groups, the caption says so in words — "two speeds" is the finding, the bars are the proof.
 */
export function LatencyHistogram({ histogram, speeds }: { histogram: Histogram; speeds: [Speed, Speed] | null }) {
  const max = histogram.bins[histogram.bins.length - 1].toMs
  const tallest = Math.max(1, ...histogram.bins.map((b) => b.count))
  const markers = [
    { label: 'median', ms: histogram.p50Ms },
    { label: 'p95', ms: histogram.p95Ms },
    { label: 'p99', ms: histogram.p99Ms },
    // Markers closer than 6% of the axis would print on top of each other: keep the first of each cluster.
  ].filter((m, i, all) => i === 0 || (m.ms - all[i - 1].ms) / max > 0.06)

  return (
    <div data-testid="latency-histogram">
      <div className="relative mt-6 h-40">
        {markers.map((m) => (
          <div key={m.label} className="absolute -top-6 bottom-0 border-l border-dashed border-foreground/30" style={{ left: `${Math.min((m.ms / max) * 100, 100)}%` }}>
            {/* Near the right edge the label goes to the left of its line, or it would be cut off. */}
            <span className={`absolute top-0 font-mono text-[10px] tracking-wider whitespace-nowrap text-muted-foreground uppercase ${m.ms / max > 0.75 ? 'right-1.5' : 'left-1.5'}`}>
              {m.label} {formatDuration(m.ms)}
            </span>
          </div>
        ))}
        <div className="flex h-full items-end gap-0.5" role="img" aria-label="Latency distribution">
          {histogram.bins.map((b, i) => (
            <span
              key={b.fromMs}
              data-testid="histogram-bin"
              title={`${formatDuration(b.fromMs)} – ${i === histogram.bins.length - 1 && histogram.overflow ? 'and slower' : formatDuration(b.toMs)} · ${b.count} calls (${pct(b.count / histogram.total)})`}
              className={`flex-1 rounded-t-[2px] ${b.count ? 'bg-chart-1/70' : 'bg-foreground/10'}`}
              style={{ height: b.count ? `${Math.max((b.count / tallest) * 100, 2)}%` : '1px' }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>0</span>
        <span>{formatDuration(max / 2)}</span>
        <span>
          {histogram.overflow ? '≥ ' : ''}
          {formatDuration(max)}
        </span>
      </div>
      {speeds && (
        <p className="mt-3 font-mono text-[11px] tracking-wider text-muted-foreground uppercase" data-testid="two-speeds">
          <span className="text-warning">Two speeds</span> · {formatDuration(speeds[0].medianMs)} ({pct(speeds[0].share)}) and {formatDuration(speeds[1].medianMs)} ({pct(speeds[1].share)}) ·{' '}
          {Math.round(speeds[1].medianMs / speeds[0].medianMs)}× apart
        </p>
      )}
    </div>
  )
}
