// Types come straight from the collector, so the UI can't drift from the API.
import type { ChatEvent, EvidenceCard, VersionStats } from '../../src/collector/chat'
import type { NormalizedSpan, OperationStats, ServiceInfo, TraceSummary } from '../../src/collector/types'

export type { ChatEvent, EvidenceCard, VersionStats, NormalizedSpan, OperationStats, ServiceInfo, TraceSummary }

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
  services: () => get<ServiceInfo[]>('/api/services'),
  traces: (search: TraceSearch) => get<TraceSummary[]>(`/api/traces${query({ ...search, limit: 200 })}`),
  trace: (traceId: string) => get<{ traceId: string; spans: NormalizedSpan[] }>(`/api/traces/${traceId}`),
  chatInfo: () => get<ChatInfo>('/api/chat'),

  /** Streams one chat turn: calls onEvent for every NDJSON line as the agents work. */
  async ask(question: string, onEvent: (event: ChatEvent) => void): Promise<void> {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
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
