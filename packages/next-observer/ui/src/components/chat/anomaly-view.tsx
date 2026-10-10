import type { Anomaly } from '@/api'
import { Badge } from '@/components/ui/badge'

const pct = (n: number) => `${Math.round(n * 100)}%`

export function anomalyHeadline(a: Anomaly): string {
  const seconds = Math.round(a.windowMs / 1000)
  const of = a.subject ? `${a.sampleSize} ${a.subject.operation} requests` : `${a.sampleSize} requests`
  switch (a.type) {
    case 'high_error_rate':
      return `High error rate · ${pct(a.value)} of ${of} failed in ${seconds}s`
    case 'high_latency':
      return `Slow requests · ${pct(a.value)} of ${of} were slow in ${seconds}s`
    case 'no_traffic':
      return `No traffic · silent for ${a.value}s`
    case 'check_failed':
      if (!a.check) return 'Check failing'
      if (a.check.alsoUnreachable?.length) return `App unreachable · ${a.check.alsoUnreachable.length + 1} checks get no connection to ${a.check.origin}`
      return a.check.rule === 'in_row' ? `Check failing · "${a.check.name}" failed ${a.value} times in a row` : `Check unreliable · "${a.check.name}" failed ${a.value} of its last ${a.sampleSize} runs`
    case 'data_integrity':
      return `Wrong data · ${a.value} response${a.value === 1 ? '' : 's'} to ${of} came back wrong in ${seconds}s`
  }
}

// Red is for critical only; a warning is amber, like slow spans elsewhere.
const TONE = {
  critical: { frame: 'border-destructive/40 bg-destructive/5', badge: 'bg-destructive/15 text-destructive' },
  warning: { frame: 'border-warning/40 bg-warning/5', badge: 'bg-warning/15 text-warning' },
}

export function AnomalyView({ anomaly }: { anomaly: Anomaly }) {
  const tone = TONE[anomaly.severity]
  return (
    <div className={`space-y-1 rounded-xl border px-3 py-2 text-sm ${tone.frame}`} data-testid="anomaly" data-type={anomaly.type} data-severity={anomaly.severity}>
      <div className="flex items-center gap-2 font-medium">
        <Badge className={`font-mono ${tone.badge}`}>{anomaly.severity}</Badge>
        {anomalyHeadline(anomaly)}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{new Date(anomaly.detectedAtMs).toLocaleTimeString()}</span>
      </div>
      {anomaly.check && (
        <p className="font-mono text-xs text-muted-foreground" data-testid="anomaly-check">
          {anomaly.check.method} {anomaly.check.url} · {anomaly.check.reason}
        </p>
      )}
      {anomaly.integrityFailures && anomaly.integrityFailures.length > 0 ? (
        <ul className="font-mono text-xs text-muted-foreground">
          {anomaly.integrityFailures.map((f, i) => (
            <li key={`${f.traceId}-${i}`}>
              {f.operation} · asked for {JSON.stringify(f.expected)}, got back {JSON.stringify(f.actual)} (trace {f.traceId.slice(0, 8)})
            </li>
          ))}
        </ul>
      ) : (
        anomaly.operations.length > 0 && (
          <ul className="font-mono text-xs text-muted-foreground">
            {anomaly.operations.map((o) => (
              <li key={`${o.service}:${o.operation}`}>
                {o.operation} · {o.errors} errors, {o.slow} slow of {o.count}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
