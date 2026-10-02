import { Badge } from '@/components/ui/badge'

const EXPLANATION =
  'The first request of this route after the server started. In next dev it includes compiling the route, so it is ' +
  'slower than the rest — the agents leave it out of latency statistics.'

export function ColdStartBadge() {
  return (
    <Badge variant="outline" title={EXPLANATION} className="ml-2 cursor-help font-normal text-muted-foreground">
      cold start
    </Badge>
  )
}
