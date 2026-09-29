// Types come straight from the collector, so the UI can't drift from the API.
import type { NormalizedSpan, OperationStats, ServiceInfo, TraceSummary } from '../../src/collector/types'

export type { NormalizedSpan, OperationStats, ServiceInfo, TraceSummary }

export interface TraceSearch {
  service?: string
  operation?: string
  minDurationMs?: number
  hasError?: boolean
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') q.set(key, String(value))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  services: () => get<ServiceInfo[]>('/api/services'),
  traces: (search: TraceSearch) => get<TraceSummary[]>(`/api/traces${query({ ...search, limit: 200 })}`),
  trace: (traceId: string) => get<{ traceId: string; spans: NormalizedSpan[] }>(`/api/traces/${traceId}`),
}
