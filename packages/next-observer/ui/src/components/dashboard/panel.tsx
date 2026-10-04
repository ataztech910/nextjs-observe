import { TrendingDown, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

// A dashboard card: title, an optional count, the change since the previous window, a legend or totals on the right.
export function Panel({ title, count, change, children, aside, testId }: { title: string; count?: ReactNode; change?: ReactNode; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Card className="gap-0 py-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3.5">
        <h2 className="font-medium">{title}</h2>
        {count !== undefined && <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{count}</span>}
        {change}
        {aside && <div className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">{aside}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  )
}

/**
 * "+25% since last period". `upIsBad` colors the direction: more latency or errors is bad, more traffic is neutral.
 * Nothing to compare with (no traffic before) shows nothing rather than a made-up 0%.
 */
export function Change({ value, upIsBad }: { value: number | null; upIsBad?: boolean }) {
  if (value === null) return null
  const pct = Math.round(value * 100)
  const up = pct > 0
  const tone = pct === 0 || upIsBad === undefined ? 'text-muted-foreground' : up === upIsBad ? 'text-destructive' : 'text-signal'
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`flex items-center gap-1 text-xs ${tone}`} data-testid="change">
      {pct !== 0 && <Icon className="size-3.5" aria-hidden />}
      {up ? '+' : ''}
      {pct}% <span className="text-muted-foreground">since last period</span>
    </span>
  )
}

export function Legend({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-0.5 rounded-full ${tone}`} aria-hidden />
      {children}
    </span>
  )
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground tabular-nums">{children}</span>
    </span>
  )
}

export function TimeAxis({ fromMs, toMs }: { fromMs: number; toMs: number }) {
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
      <span>{fmt(fromMs)}</span>
      <span>{fmt(toMs)}</span>
    </div>
  )
}
