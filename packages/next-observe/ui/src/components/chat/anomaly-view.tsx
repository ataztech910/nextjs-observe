import type { Anomaly } from '@/api'
import { Badge } from '@/components/ui/badge'

const pct = (n: number) => `${Math.round(n * 100)}%`

export function anomalyHeadline(a: Anomaly): string {
  const seconds = Math.round(a.windowMs / 1000)
  switch (a.type) {
    case 'high_error_rate':
      return `High error rate · ${pct(a.value)} of ${a.sampleSize} requests failed in ${seconds}s`
    case 'high_latency':
      return `Slow requests · ${pct(a.value)} of ${a.sampleSize} requests were slow in ${seconds}s`
    case 'no_traffic':
      return `No traffic · silent for ${a.value}s`
  }
}

export function AnomalyView({ anomaly }: { anomaly: Anomaly }) {
  return (
    <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm" data-testid="anomaly" data-type={anomaly.type}>
      <div className="flex items-center gap-2 font-medium">
        <Badge variant="destructive">{anomaly.severity}</Badge>
        {anomalyHeadline(anomaly)}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{new Date(anomaly.detectedAtMs).toLocaleTimeString()}</span>
      </div>
      {anomaly.operations.length > 0 && (
        <ul className="font-mono text-xs text-muted-foreground">
          {anomaly.operations.map((o) => (
            <li key={`${o.service}:${o.operation}`}>
              {o.operation} · {o.errors} errors, {o.slow} slow of {o.count}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
