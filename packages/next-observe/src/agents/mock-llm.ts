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
  for (const content of request.contents) {
    const text = content.parts?.find((p) => p.text)?.text
    if (content.role === 'user' && text) return text
  }
  return ''
}

export class MockLlm extends BaseLlm {
  constructor() {
    super({ model: 'mock' })
  }

  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const parts = request.contents.flatMap((c) => c.parts ?? [])
    const called = new Set(parts.map((p) => p.functionCall?.name).filter(Boolean))
    const question = questionOf(request)

    for (const tool of Object.values(request.toolsDict ?? {})) {
      if (called.has(tool.name)) continue
      const declaration = tool._getDeclaration() as Declaration | undefined
      const required = declaration?.parameters?.required ?? declaration?.parametersJsonSchema?.required ?? []
      // Agent-as-tool takes the question as `request`; tools needing other required args (e.g. traceId) are skipped.
      if (required.some((name) => name !== 'request')) continue
      const args = required.includes('request') ? { request: question } : {}
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
