import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { TraceSummary } from '@/api'
import { ColdStartBadge } from '@/components/cold-start-badge'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDuration } from '@/lib/waterfall'

/** The list of traces — on the Traces page and under an operation. `empty` is what to say when there are none. */
export function TracesTable({ traces, empty }: { traces: TraceSummary[] | undefined; empty: ReactNode }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Trace</TableHead>
            <TableHead>Services</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Spans</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="pr-4 text-right">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces?.map((t) => (
            <TableRow key={t.traceId} data-testid="trace-row">
              <TableCell className="pl-4">
                <Link to="/traces/$traceId" params={{ traceId: t.traceId }} className="font-medium hover:underline">
                  {t.rootName}
                </Link>
                {t.coldStart && <ColdStartBadge />}
                <div className="font-mono text-xs text-muted-foreground">{t.traceId.slice(0, 16)}</div>
              </TableCell>
              <TableCell className="space-x-1">
                {t.services.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatDuration(t.durationMs)}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{t.spanCount}</TableCell>
              <TableCell className="text-right">{t.errorCount > 0 ? <Badge variant="destructive">{t.errorCount}</Badge> : '—'}</TableCell>
              <TableCell className="pr-4 text-right font-mono text-xs text-muted-foreground tabular-nums">{new Date(t.startTimeMs).toLocaleTimeString()}</TableCell>
            </TableRow>
          ))}
          {traces?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
