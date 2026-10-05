import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Rocket, X } from 'lucide-react'
import { useState } from 'react'
import { api, type Regression } from '@/api'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/waterfall'

const REFRESH_MS = 5000
const STORAGE_KEY = 'next-observer:regression-dismissed'
const pct = (n: number) => `${Math.round(n * 100)}%`

// One banner per finding: dismissing "v2 slowed checkout" keeps quiet until something else regresses.
const idOf = (r: Regression) => `${r.service}@${r.version}:${r.kind}:${r.operation}`

// sessionStorage can be unavailable (private mode, blocked site data) — then a dismissal lasts until reload.
function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function writeDismissed(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id)
  } catch {
    // nothing to do
  }
}

/** "v2 looks like a regression" — measured numbers from the observer; Investigate hands the question to the agents. */
export function RegressionBanner() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(readDismissed)
  const { data } = useQuery({ queryKey: ['regression'], queryFn: api.regression, refetchInterval: REFRESH_MS })
  const r = data?.regression
  if (!r || idOf(r) === dismissed) return null

  const dismiss = () => {
    writeDismissed(idOf(r))
    setDismissed(idOf(r))
  }
  const operation = (
    <Link to="/traces" search={{ operation: r.operation }} className="font-mono text-[0.9em] underline decoration-dotted underline-offset-4 hover:text-signal">
      {r.operation}
    </Link>
  )
  return (
    <aside
      role="status"
      data-testid="regression-banner"
      data-kind={r.kind}
      className="fixed right-6 bottom-6 z-30 w-[26rem] max-w-[calc(100vw-3rem)] rounded-2xl border border-warning/30 bg-popover/95 p-5 shadow-2xl shadow-black/50 backdrop-blur-md"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warning/40 bg-warning/10 text-warning">
          <Rocket className="size-4" aria-hidden />
        </span>
        <h2 className="flex-1 pt-1.5 font-medium">
          <span className="font-mono">{r.version}</span> looks like a regression
        </h2>
        <button type="button" aria-label="Dismiss" onClick={dismiss} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        Since <span className="font-mono">{r.version}</span> went out,{' '}
        {r.kind === 'errors' ? (
          <>
            the error rate of {operation} moved from <b className="font-mono font-medium">{pct(r.from.errorRate)}</b> to{' '}
            <b className="font-mono font-medium text-destructive">{pct(r.to.errorRate)}</b>.
          </>
        ) : (
          <>
            p95 of {operation} moved from <b className="font-mono font-medium">{formatDuration(r.from.p95Ms)}</b> to{' '}
            <b className="font-mono font-medium text-warning">{formatDuration(r.to.p95Ms)}</b>
            {r.p95Ratio !== null && <span className="text-muted-foreground"> (×{r.p95Ratio})</span>}.
          </>
        )}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The agents can compare <span className="font-mono">{r.previousVersion}</span> and <span className="font-mono">{r.version}</span> and point at the code.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="regression-investigate"
          onClick={() => {
            dismiss()
            void navigate({ to: '/chat', search: { ask: r.question } })
          }}
        >
          Investigate
        </Button>
      </div>
    </aside>
  )
}
