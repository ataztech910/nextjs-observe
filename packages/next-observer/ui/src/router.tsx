import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router'
import type { TraceSearch } from '@/api'
import type { ReactNode } from 'react'
import { LiveIndicator } from '@/components/live-indicator'
import { ObserverOffline } from '@/components/observer-offline'
import { RegressionBanner } from '@/components/regression-banner'
import { ChatPage } from '@/pages/chat-page'
import { parseWindow, type WindowKey } from '@/components/window-picker'
import { DashboardPage } from '@/pages/dashboard-page'
import { ErrorsPage } from '@/pages/errors-page'
import { OperationPage } from '@/pages/operation-page'
import { TracePage } from '@/pages/trace-page'
import { TracesPage } from '@/pages/traces-page'

function NavLink({ to, children }: { to: '/' | '/errors' | '/traces' | '/chat'; children: ReactNode }) {
  return (
    <Link to={to} activeOptions={{ exact: to === '/', includeSearch: false }} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground">
      {children}
    </Link>
  )
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-6">
          <Link to="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="size-2.5 rounded-sm bg-signal shadow-[0_0_12px_var(--signal)]" />
            next-observer
          </Link>
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/errors">Errors</NavLink>
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
      <RegressionBanner />
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): { window?: WindowKey; service?: string } => ({
    window: parseWindow(search.window),
    service: typeof search.service === 'string' && search.service.trim() ? search.service.trim() : undefined,
  }),
  component: DashboardPage,
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

const errorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/errors',
  validateSearch: (search: Record<string, unknown>): { window?: WindowKey; service?: string } => ({
    window: parseWindow(search.window),
    service: typeof search.service === 'string' && search.service.trim() ? search.service.trim() : undefined,
  }),
  component: ErrorsPage,
})

// The operation is a search parameter, not a path segment: names like "GET /api/inventory/[id]" contain slashes.
const operationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operation',
  validateSearch: (search: Record<string, unknown>): { name: string; service?: string; window?: WindowKey } => ({
    name: typeof search.name === 'string' ? search.name : '',
    service: typeof search.service === 'string' && search.service.trim() ? search.service.trim() : undefined,
    window: parseWindow(search.window),
  }),
  component: OperationPage,
})

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  // `ask`: a question to send right away — how the regression banner hands over to the agents.
  validateSearch: (search: Record<string, unknown>): { ask?: string } => ({ ask: typeof search.ask === 'string' && search.ask.trim() ? search.ask.trim() : undefined }),
  component: ChatPage,
})

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, errorsRoute, tracesRoute, traceRoute, operationRoute, chatRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
