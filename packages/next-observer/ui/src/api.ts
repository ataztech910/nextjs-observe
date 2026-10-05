// Types come straight from the collector, so the UI can't drift from the API.
import type { ChatEvent, EvidenceCard, ProactiveEvent, VersionStats } from '../../src/collector/chat'
import type { Anomaly } from '../../src/debug/detector'
import type { Defect } from '../../src/collector/defects'
import type { Histogram, OperationDetails, Speed } from '../../src/collector/operation'
import type { Overview, RouteRow } from '../../src/collector/overview'
import type { Regression } from '../../src/debug/regression'
import type { NormalizedSpan, OperationStats, ServiceInfo, TraceSpan, TraceSummary } from '../../src/collector/types'

export type { Anomaly, Defect, Histogram, OperationDetails, Speed, Overview, Regression, RouteRow, ChatEvent, EvidenceCard, ProactiveEvent, VersionStats, NormalizedSpan, OperationStats, ServiceInfo, TraceSpan, TraceSummary }

export type ChatInfo = { enabled: true; mode: 'mock' | 'real' } | { enabled: false; reason: string }

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
  health: () => get<{ status: string; spans: number }>('/health'),
  services: () => get<ServiceInfo[]>('/api/services'),
  traces: (search: TraceSearch & { exactOperation?: boolean; fromMs?: number; limit?: number }) => get<TraceSummary[]>(`/api/traces${query({ limit: 200, ...search })}`),
  trace: (traceId: string) => get<{ traceId: string; spans: TraceSpan[] }>(`/api/traces/${traceId}`),
  overview: (windowMs: number, service?: string) => get<Overview>(`/api/overview${query({ windowMs, service })}`),
  operation: (operation: string, windowMs: number, service?: string, toMs?: number) => get<OperationDetails>(`/api/operation${query({ operation, windowMs, service, toMs })}`),
  defects: (windowMs: number, service?: string) => get<Defect[]>(`/api/defects${query({ windowMs, service })}`),
  regression: () => get<{ regression: Regression | null }>('/api/regression'),
  chatInfo: () => get<ChatInfo>('/api/chat'),

  /** Streams one chat turn: calls onEvent for every NDJSON line as the agents work. */
  async ask(question: string, sessionId: string | undefined, onEvent: (event: ChatEvent) => void): Promise<void> {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, sessionId }) })
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      onEvent({ type: 'error', message: body.error ?? `chat failed: ${res.status}` })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ChatEvent)
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent)
  },
}
