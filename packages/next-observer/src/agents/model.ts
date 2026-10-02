// Picks the model for all agents from env:
//   OBSERVE_AI=mock (default) → MockLlm: no network, no tokens — for developing tools, UI and the chat pipeline
//   OBSERVE_AI=real           → Gemini when GEMINI_API_KEY is set (model name from GEMINI_MODEL, never hardcoded),
//                               otherwise Kitana (Claude / Codex CLI, Ollama or API key — see @kitana-sdk/adk)
import type { BaseLlm } from '@google/adk'
import { MockLlm } from './mock-llm.js'

export type AiMode = 'mock' | 'real'
export type Env = Record<string, string | undefined>

export function resolveAiMode(env: Env): AiMode {
  const mode = env.OBSERVE_AI ?? 'mock'
  if (mode !== 'mock' && mode !== 'real') throw new Error(`OBSERVE_AI must be "mock" or "real", got "${mode}"`)
  return mode
}

export async function getModel(env: Env = process.env): Promise<BaseLlm | string> {
  if (resolveAiMode(env) === 'mock') return new MockLlm()
  if (env.GEMINI_API_KEY) {
    if (!env.GEMINI_MODEL) throw new Error('GEMINI_API_KEY is set but GEMINI_MODEL is not — set the Gemini model name to use')
    return env.GEMINI_MODEL // ADK resolves gemini-* names and reads GEMINI_API_KEY itself
  }
  // Optional peer dependency: only needed when running real agents without a Gemini key.
  const { KitanaLlm } = await import('@kitana-sdk/adk')
  return new KitanaLlm({ model: env.OBSERVE_KITANA_MODEL ?? 'auto' })
}
