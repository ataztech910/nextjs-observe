import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api, type CheckStatus } from '@/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { checkQuestion, checkState, everyWords, expectWords, passedWords, sortChecks, traceWorthOpening, type CheckState } from '@/lib/checks'

const REFRESH_MS = 2000

const EXAMPLE = `export default [
  { name: 'catalog answers fast', url: '/api/products', expect: { status: 200, maxMs: 300 } },
  { name: 'guests cannot see orders', url: '/api/orders', expect: { status: [401, 403] } },
]`

// Red only for what is down now; a check that fails now and then is amber, like slow spans elsewhere.
const TONE: Record<CheckState, { label: string; badge: string }> = {
  failing: { label: 'failing', badge: 'bg-destructive/15 text-destructive' },
  unreliable: { label: 'unreliable', badge: 'bg-warning/15 text-warning' },
  passing: { label: 'passing', badge: 'bg-signal/15 text-signal' },
  waiting: { label: 'waiting', badge: 'bg-muted text-muted-foreground' },
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

export function ChecksPage() {
  const checks = useQuery({ queryKey: ['checks'], queryFn: api.checks, refetchInterval: REFRESH_MS })
  const list = checks.data ? sortChecks(checks.data.checks) : undefined
  const notPassing = list?.filter((c) => ['failing', 'unreliable'].includes(checkState(c))).length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader title="Checks" count={list?.length} subtitle="Requests the observer sends on a timer — is the app up, fast enough, still refusing what it must refuse." />

      {!list ? (
        <p className="text-muted-foreground">{checks.isError ? 'The observer is not reachable.' : 'Loading…'}</p>
      ) : list.length === 0 ? (
        <Card className="gap-3 px-5 py-8" data-testid="checks-empty">
          <p className="font-medium">No checks yet</p>
          <p className="text-sm text-muted-foreground">
            Put <span className="font-mono text-foreground">observe.checks.ts</span> in the app root and restart the observer:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-xs">{EXAMPLE}</pre>
        </Card>
      ) : (
        <>
          <p className="font-mono text-sm text-muted-foreground" data-testid="checks-summary">
            {notPassing === 0 ? 'All passing.' : `${notPassing} of ${list.length} not passing — the AI agents look into a check that fails twice in a row.`}
          </p>
          <div className="space-y-4">
            {list.map((c) => (
              <CheckCard key={c.name} check={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CheckCard({ check: c }: { check: CheckStatus }) {
  const navigate = useNavigate()
  const state = checkState(c)
  const tone = TONE[state]
  const peak = Math.max(1, ...c.history.map((r) => r.durationMs))
  const trace = traceWorthOpening(c.history)
  return (
    <Card className="gap-0 py-0" data-testid="check" data-state={state}>
      <div className="grid gap-x-6 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] tracking-wider uppercase ${tone.badge}`} data-testid="check-state">
              {tone.label}
            </span>
            <span className="font-medium" data-testid="check-name">
              {c.name}
            </span>
          </div>
          <p className="font-mono text-sm break-all text-muted-foreground">
            <span className="text-foreground">{c.method}</span> {c.url}
          </p>
          <p className="text-sm text-muted-foreground">
            expects <span className="font-mono text-foreground">{expectWords(c.expect)}</span> · {everyWords(c.everySeconds)}
          </p>
          {c.last &&
            (c.last.ok ? (
              <p className="font-mono text-sm text-muted-foreground" data-testid="check-last">
                {c.last.status} · {Math.round(c.last.durationMs)} ms · {ago(c.last.atMs)}
              </p>
            ) : (
              <p className="font-mono text-sm break-words text-destructive" data-testid="check-last">
                {c.last.reason} · {ago(c.last.atMs)}
              </p>
            ))}
          {!c.last && <p className="font-mono text-sm text-muted-foreground">no run yet — the first one comes a few seconds after the app starts answering</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            <span data-testid="check-passed">{c.history.length > 0 ? passedWords(c.history) : 'no runs'}</span>
            {c.failures > 0 && <span className="text-destructive">{c.failures} in a row</span>}
          </div>
          {/* One bar per run, oldest first: height is the time it took, red is a failed run. */}
          <div className="flex h-8 items-end gap-0.5" data-testid="check-history">
            {c.history.map((r) => (
              <span
                key={r.traceId}
                title={`${new Date(r.atMs).toLocaleTimeString()} · ${r.ok ? `${r.status} · ${Math.round(r.durationMs)} ms` : r.reason}`}
                className={`max-w-2 flex-1 rounded-[2px] ${r.ok ? 'bg-signal/70' : 'bg-destructive'}`}
                // A failed run is often the fastest one (an instant 500) — it must not shrink to a dot.
                style={{ height: `${Math.max((r.durationMs / peak) * 100, r.ok ? 12 : 45)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-5 py-2.5 font-mono text-xs text-muted-foreground">
        {trace ? (
          <span className="flex items-center gap-2">
            {trace.ok ? 'last trace' : 'last failed trace'}
            <Link to="/traces/$traceId" params={{ traceId: trace.traceId }} className="text-signal underline-offset-2 hover:underline" data-testid="check-trace">
              {trace.traceId.slice(0, 6)}…{trace.traceId.slice(-4)}
            </Link>
          </span>
        ) : (
          <span>no trace — nothing has answered yet</span>
        )}
        <Button type="button" size="sm" variant="outline" className="ml-auto font-sans" data-testid="check-investigate" onClick={() => void navigate({ to: '/chat', search: { ask: checkQuestion(c) } })}>
          Investigate
        </Button>
      </div>
    </Card>
  )
}
