import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

// Shares the health query with ObserverOffline (same key), so it costs no extra request.
export function LiveIndicator() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 2000, retry: false })
  const live = health.isSuccess
  return (
    <span
      data-testid="live-indicator"
      className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-wider ${live ? 'border-signal/30 text-signal' : 'border-destructive/40 text-destructive'}`}
    >
      <span className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-signal' : 'bg-destructive'}`} />
      {live ? 'LIVE' : 'OFFLINE'}
      {live && <span className="text-muted-foreground tabular-nums">· {health.data.spans} spans</span>}
    </span>
  )
}
