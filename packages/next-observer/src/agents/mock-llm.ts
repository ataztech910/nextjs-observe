// Deterministic stand-in for a real model: exercises the whole agent pipeline (orchestrator → specialists → tools)
// without network or tokens. Each turn it calls the next tool it hasn't called yet (one call per turn, like Kitana);
// when none are left it answers with a "[mock]" summary of the tool results it saw.
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk'

export const MOCK_PREFIX = '[mock]'

interface Declaration {
  name?: string
  parameters?: { required?: string[] }
  parametersJsonSchema?: { required?: string[] }
}

function questionOf(request: LlmRequest): string {
  for (const content of [...request.contents].reverse()) {
    const text = content.parts?.find((p) => p.text)?.text
    if (content.role === 'user' && text) return text
  }
  return ''
}

/**
 * The slowest trace a tool has listed in this turn (search_traces returns traces with durationMs) — so get_trace opens a
 * real trace, the one a person would open, instead of being skipped or called with an invented id.
 */
function slowestTraceId(parts: { functionResponse?: { response?: unknown } }[]): string | undefined {
  let best: { traceId: string; durationMs: number } | undefined
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const v = value as Record<string, unknown>
    if (typeof v.traceId === 'string' && /^[0-9a-f]{32}$/.test(v.traceId)) {
      const durationMs = typeof v.durationMs === 'number' ? v.durationMs : 0
      if (!best || durationMs > best.durationMs) best = { traceId: v.traceId, durationMs }
    }
    Object.values(v).forEach(visit)
  }
  for (const part of parts) visit(part.functionResponse?.response)
  return best?.traceId
}

export class MockLlm extends BaseLlm {
  constructor() {
    super({ model: 'mock' })
  }

  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    // Only the current turn counts: with a session, earlier questions and their tool calls are in the history too.
    const turnStart = request.contents.findLastIndex((c) => c.role === 'user' && c.parts?.some((p) => p.text))
    const parts = request.contents.slice(Math.max(turnStart, 0)).flatMap((c) => c.parts ?? [])
    const called = new Set(parts.map((p) => p.functionCall?.name).filter(Boolean))
    const question = questionOf(request)

    for (const tool of Object.values(request.toolsDict ?? {})) {
      if (called.has(tool.name)) continue
      const declaration = tool._getDeclaration() as Declaration | undefined
      const required = declaration?.parameters?.required ?? declaration?.parametersJsonSchema?.required ?? []
      // Agent-as-tool takes the question as `request`; `traceId` comes from a trace listed earlier in this turn. Tools needing
      // anything else — or a trace id when none was listed yet — are skipped rather than called with garbage.
      if (required.some((name) => name !== 'request' && name !== 'traceId')) continue
      const traceId = required.includes('traceId') ? slowestTraceId(parts) : undefined
      if (required.includes('traceId') && !traceId) continue
      const args = { ...(required.includes('request') ? { request: question } : {}), ...(traceId ? { traceId } : {}) }
      yield { content: { role: 'model', parts: [{ functionCall: { name: tool.name, args } }] }, turnComplete: true }
      return
    }

    const results = parts
      .filter((p) => p.functionResponse)
      .map((p) => `${p.functionResponse!.name}: ${JSON.stringify(p.functionResponse!.response).slice(0, 400)}`)
    const text = `${MOCK_PREFIX} ${results.length ? results.join(' | ') : `no tools; question was: ${question}`}`
    yield { content: { role: 'model', parts: [{ text }] }, turnComplete: true }
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error('MockLlm does not support live connections')
  }
}
