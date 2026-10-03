import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect } from '@tanstack/react-router'
import type { TraceSearch } from '@/api'
import type { ReactNode } from 'react'
import { LiveIndicator } from '@/components/live-indicator'
import { ObserverOffline } from '@/components/observer-offline'
import { ChatPage } from '@/pages/chat-page'
import { TracePage } from '@/pages/trace-page'
import { TracesPage } from '@/pages/traces-page'

function NavLink({ to, children }: { to: '/traces' | '/chat'; children: ReactNode }) {
  return (
    <Link to={to} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground">
      {children}
    </Link>
  )
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-6">
          <Link to="/traces" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="size-2.5 rounded-sm bg-signal shadow-[0_0_12px_var(--signal)]" />
            next-observer
          </Link>
          <NavLink to="/traces">Traces</NavLink>
          <NavLink to="/chat">Chat</NavLink>
          <span className="ml-auto">
            <LiveIndicator />
          </span>
        </div>
      </header>
      <ObserverOffline />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/traces' })
  },
})

// Filters live in the URL: shareable, back-button friendly, and agents can link to a ready-made search.
function validateTraceSearch(search: Record<string, unknown>): TraceSearch {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const minDurationMs = Number(search.minDurationMs)
  return {
    service: text(search.service),
    operation: text(search.operation),
    minDurationMs: Number.isFinite(minDurationMs) && minDurationMs > 0 ? minDurationMs : undefined,
    hasError: search.hasError === true || search.hasError === 'true' ? true : undefined,
  }
}

const tracesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/traces',
  validateSearch: validateTraceSearch,
  component: TracesPage,
})

const traceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/traces/$traceId',
  component: TracePage,
})

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
})

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, tracesRoute, traceRoute, chatRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
