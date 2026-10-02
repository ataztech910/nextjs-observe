import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect } from '@tanstack/react-router'
import type { TraceSearch } from '@/api'
import { ChatPage } from '@/pages/chat-page'
import { TracePage } from '@/pages/trace-page'
import { TracesPage } from '@/pages/traces-page'

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-12 items-center gap-6 border-b px-6">
        <Link to="/traces" className="font-semibold">
          next-observer
        </Link>
        <Link to="/traces" className="text-sm text-muted-foreground [&.active]:text-foreground">
          Traces
        </Link>
        <Link to="/chat" className="text-sm text-muted-foreground [&.active]:text-foreground">
          Chat
        </Link>
      </header>
      <main className="p-6">
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
