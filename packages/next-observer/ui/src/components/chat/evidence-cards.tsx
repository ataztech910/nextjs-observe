import { Link } from '@tanstack/react-router'
import type { EvidenceCard, VersionStats } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDuration } from '@/lib/waterfall'

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)

function TraceLink({ traceId, children }: { traceId: string; children?: React.ReactNode }) {
  return (
    <Link to="/traces/$traceId" params={{ traceId }} className="font-mono text-xs text-signal underline-offset-2 hover:underline">
      {children ?? `${traceId.slice(0, 6)}…${traceId.slice(-4)}`}
    </Link>
  )
}

function Bar({ label, ms, max, tone }: { label: string; ms: number; max: number; tone: string }) {
  return (
    <div className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2.5 rounded-sm bg-muted">
        <span className={`block h-2.5 rounded-sm ${tone}`} style={{ width: `${Math.max((ms / max) * 100, 1)}%` }} />
      </span>
      <span className="text-right font-mono tabular-nums">{formatDuration(ms)}</span>
    </div>
  )
}

function VersionBars({ v, max, tone }: { v: VersionStats; max: number; tone: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">
        {v.version} <span className="font-normal text-muted-foreground">· {v.count} calls · errors {pct(v.errorRate)}</span>
      </div>
      <Bar label="p50" ms={v.p50Ms} max={max} tone={tone} />
      <Bar label="p95" ms={v.p95Ms} max={max} tone={tone} />
    </div>
  )
}

function Frame({ title, badge, children, testKind }: { title: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; testKind: string }) {
  return (
    <Card size="sm" data-testid="evidence-card" data-kind={testKind}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {title}
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  )
}

export function EvidenceCardView({ card }: { card: EvidenceCard }) {
  switch (card.kind) {
    case 'regression': {
      const max = Math.max(card.from.p95Ms, card.to.p95Ms, 1)
      return (
        <Frame testKind={card.kind} title={<>Regression · {card.operation}</>} badge={card.p95Ratio !== null && <Badge variant="destructive">p95 ×{card.p95Ratio}</Badge>}>
          <VersionBars v={card.from} max={max} tone="bg-chart-1" />
          <VersionBars v={card.to} max={max} tone="bg-destructive" />
          <p className="text-xs text-muted-foreground">
            {card.service} · deployed {card.from.version} → {card.to.version}
          </p>
        </Frame>
      )
    }
    case 'errors':
      return (
        <Frame testKind={card.kind} title={<>Failing · {card.operation}</>} badge={<Badge variant="destructive">{pct(card.errorRate)}</Badge>}>
          <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-2 font-mono text-xs text-destructive">{card.message}</pre>
          <p className="text-xs text-muted-foreground">
            {card.errors} errors in {card.service} · examples:{' '}
            {card.traceIds.map((id) => (
              <span key={id} className="mr-2">
                <TraceLink traceId={id} />
              </span>
            ))}
          </p>
        </Frame>
      )
    case 'n-plus-one':
      return (
        <Frame testKind={card.kind} title={<>N+1 · {card.count} × {card.operation}</>} badge={<Badge variant="secondary">{formatDuration(card.totalMs)}</Badge>}>
          <p className="text-xs">
            <span className="font-mono">{card.parent}</span> calls <span className="font-mono">{card.operation}</span> {card.count} times — one batched call would do.
          </p>
          <TraceLink traceId={card.traceId}>open trace</TraceLink>
        </Frame>
      )
    case 'hotspot':
      return (
        <Frame testKind={card.kind} title={<>Hotspot · {card.operation}</>} badge={<Badge variant="secondary">{pct(card.selfMs / card.traceMs)} of trace</Badge>}>
          <p className="text-xs">
            {formatDuration(card.selfMs)} of {formatDuration(card.traceMs)} spent in its own code
          </p>
          <p className="font-mono text-xs">{card.codeFile}</p>
          <TraceLink traceId={card.traceId}>open trace</TraceLink>
        </Frame>
      )
    case 'silent':
      return (
        <Frame testKind={card.kind} title={<>No traffic · {card.service}</>} badge={<Badge variant="destructive">silent</Badge>}>
          <p className="text-xs">Last span {card.lastSpanSecondsAgo}s ago.</p>
        </Frame>
      )
    case 'traces':
      return (
        <Frame testKind={card.kind} title={card.label}>
          <ul className="space-y-1">
            {card.traces.map((t) => (
              <li key={t.traceId} className="flex items-center gap-2 text-xs">
                <TraceLink traceId={t.traceId}>{t.root}</TraceLink>
                <span className="tabular-nums text-muted-foreground">{formatDuration(t.durationMs)}</span>
                {t.errors > 0 && <Badge variant="destructive">{t.errors} err</Badge>}
              </li>
            ))}
          </ul>
        </Frame>
      )
  }
}
