export interface Marker {
  label: string
  ms: number
}

/**
 * The percentile markers that fit on a histogram axis of `maxMs`. Labels closer than `minGap` of the axis would print
 * on top of each other, so a marker is kept only when it is far enough from the last one KEPT (not from its
 * neighbour: median 90, p95 95, p99 100 keeps median and p99).
 */
export function histogramMarkers(p: { p50Ms: number; p95Ms: number; p99Ms: number }, maxMs: number, minGap = 0.06): Marker[] {
  const all: Marker[] = [
    { label: 'median', ms: p.p50Ms },
    { label: 'p95', ms: p.p95Ms },
    { label: 'p99', ms: p.p99Ms },
  ]
  const kept: Marker[] = []
  for (const m of all) if (kept.length === 0 || (m.ms - kept[kept.length - 1].ms) / maxMs > minGap) kept.push(m)
  return kept
}
