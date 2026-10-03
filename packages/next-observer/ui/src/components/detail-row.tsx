import type { ReactNode } from 'react'

// "label ········ value": the dotted leader keeps long attribute lists scannable. Use inside a <dl>.
export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1 text-xs">
      <dt className="flex min-w-0 flex-1 items-baseline gap-2 text-muted-foreground">
        <span className="shrink-0">{label}</span>
        <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-foreground/20" />
      </dt>
      <dd className="min-w-0 max-w-[70%] break-all text-right font-mono">{children}</dd>
    </div>
  )
}
