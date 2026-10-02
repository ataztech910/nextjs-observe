import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

// The page is served by the observer, so this only matters for a tab left open while the observer stops (Ctrl+C,
// switching v1 → v2 in the workshop). Without it the page just stays frozen with errors in the console.
export function ObserverOffline() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 2000, retry: false })
  if (!health.isError) return null
  return (
    <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
      The observer is not reachable — is <code>next-observer</code> still running? This page reconnects on its own.
    </div>
  )
}
