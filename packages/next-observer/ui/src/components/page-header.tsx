import type { ReactNode } from 'react'

// Every page opens the same way: a title, an optional count, one mono line saying what the page is for.
export function PageHeader({ title, count, subtitle, children }: { title: ReactNode; count?: number; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <span className="min-w-0 truncate">{title}</span>
          {count !== undefined && <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h1>
        {subtitle && <p className="font-mono text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
