// Orchestrator + specialist agents (Four Golden Signals split) over the telemetry tools from ../debug.
import { AgentTool, FunctionTool, InMemorySessionService, LlmAgent, Runner, type BaseLlm } from '@google/adk'
import { z } from 'zod'
import type { StorageAdapter } from '../collector/types.js'
import { createAgentQueries, type QueryOptions } from '../debug/queries.js'
import { BUILT_IN_SPECIALISTS, orchestratorInstruction, specialistInstruction, type SpecialistSpec, type ToolName } from './specialists.js'

export interface InvestigationStep {
  agent: string
  tool: string
  args: Record<string, unknown>
}

/** What the orchestrator did, in order: specialist calls, their answers, its own text. */
export interface TranscriptEntry {
  kind: 'call' | 'result' | 'text'
  agent: string
  content: string
}

export interface InvestigatorOptions {
  storage: StorageAdapter
  model: BaseLlm | string
  queryOptions?: QueryOptions
  /** Called for every tool call, specialists included — the chat shows these while the agents work. */
  onStep?: (step: InvestigationStep) => void
  /** Default: the built-in latency, error and traffic specialists. */
  specialists?: SpecialistSpec[]
}

// No .positive() here: it becomes `exclusiveMinimum` in the tool's schema, a field the Gemini API rejects (400 on every
// call of every specialist — and ADK swallows that error inside the specialist). A bad value is handled in the query.
const since = z.number().optional().describe('look back this many minutes, a positive number (default 15)')
const service = z.string().optional().describe('exact service name')
const operation = z.string().optional().describe('substring of the operation name, case-insensitive')

/**
 * A final text that starts like `{"tool_call": …}` is a tool call that leaked instead of a report. Seen in real runs:
 * the model dropped a closing brace, the provider could not parse the call, and the raw JSON came back as text —
 * so this checks the shape of the start, not whether the JSON is valid.
 */
/** A specialist's result as ADK's AgentTool reports a failed or silent run: `{"result":""}`. */
function isEmptyResult(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { result?: unknown }
    return typeof parsed.result === 'string' ? parsed.result.trim() === '' : parsed.result === undefined || parsed.result === null
  } catch {
    return false
  }
}

export function isLeakedToolCall(text: string): boolean {
  return /^\s*(?:```(?:json)?\s*)?\{\s*"tool_call"\s*:/.test(text)
}

const APP_NAME = 'next-observe'
const USER_ID = 'next-observe'

export function createInvestigator(options: InvestigatorOptions) {
  const q = createAgentQueries(options.storage, options.queryOptions)
  const specialists = options.specialists ?? BUILT_IN_SPECIALISTS
  // Conversation memory: ADK stores every question, specialist call and answer in the session; the orchestrator sees
  // them on the next turn. Specialists (AgentTool) start fresh each time and get context via the orchestrator's request.
  // In-memory: sessions end with the process.
  const sessions = new InMemorySessionService()

  /** Continues a session, or starts one (also when an id is unknown, e.g. after a restart). Returns the session id. */
  async function startSession(sessionId?: string): Promise<string> {
    if (sessionId) {
      const existing = await sessions.getSession({ appName: APP_NAME, userId: USER_ID, sessionId })
      if (existing) return existing.id
    }
    return (await sessions.createSession({ appName: APP_NAME, userId: USER_ID, sessionId })).id
  }

  // Agents are built per investigation so each ask() records into its own steps — concurrent chats don't mix.
  function buildOrchestrator(record: (step: InvestigationStep) => void, recordResult: (step: InvestigationStep, result: unknown) => void) {
    // Tools are created per agent so every step is attributed to the agent that made it.
    function tool<T extends z.ZodObject>(agent: string, name: string, description: string, parameters: T, run: (args: z.infer<T>) => Promise<unknown>) {
      return new FunctionTool({
        name,
        description,
        parameters,
        execute: async (args) => {
          const step = { agent, tool: name, args: args as Record<string, unknown> }
          record(step)
          const result = await run(args as z.infer<T>)
          recordResult(step, result)
          return result
        },
      })
    }

    const tools = (agent: string): Record<ToolName, FunctionTool> => ({
      get_services: tool(agent, 'get_services', 'Services, their deployed versions (in deploy order) and seconds since their last span.', z.object({}), () => q.getServices()),
      get_operation_stats: tool(agent, 'get_operation_stats', 'Slowest operations by p95 with p50/p99 and error rate.', z.object({ service, operation, sinceMinutes: since }), (a) => q.getOperationStats(a)),
      compare_versions: tool(agent, 'compare_versions', 'Latest deployed version vs the previous one per operation: p95 ratio and error-rate delta. `errorRateChangeSignificant: false` means the error-rate difference is within random noise for that many requests. Use it to name the deployment that caused a regression.', z.object({ service, operation, sinceMinutes: since }), (a) => q.compareVersions(a)),
      get_errors: tool(agent, 'get_errors', 'Failing operations: error rate, top exception messages (each with when it was first seen and in which versions), example trace ids.', z.object({ service, operation, sinceMinutes: since }), (a) => q.getErrors(a)),
      search_traces: tool(agent, 'search_traces', 'Recent traces matching filters, to get example trace ids.', z.object({ service, operation, minDurationMs: z.number().optional(), hasError: z.boolean().optional(), sinceMinutes: since }), (a) => q.searchTraces(a)),
      get_trace: tool(agent, 'get_trace', 'One trace as a tree with self time, errors and code file paths; `repeated` lists ≥3 identical sibling calls (N+1); `nextInternalMs` is time inside Next.js itself (routing, rendering, dev compilation), not the app code; `integrityCheck` on a span means it returned successfully, quickly, and still the wrong data — the span has no error and may not even be slow, so check this field specifically rather than assuming a clean-looking span is fine.', z.object({ traceId: z.string().describe('32-char hex trace id from search_traces, or from an anomaly question') }), (a) => q.getTrace(a)),
    })

    const agents = specialists.map((spec) => {
      const available = tools(spec.name)
      return new LlmAgent({
        name: spec.name,
        description: spec.description,
        model: options.model,
        instruction: specialistInstruction(spec),
        tools: spec.tools.map((name) => available[name]),
      })
    })

    const orchestrator = new LlmAgent({
      name: 'orchestrator',
      model: options.model,
      instruction: orchestratorInstruction(specialists),
      tools: agents.map((agent) => new AgentTool({ agent })),
    })
    return orchestrator
  }

  return {
    startSession,
    /**
     * Runs one investigation; resolves with the final report and every tool call made on the way.
     * Pass the sessionId from a previous answer to continue that conversation. Safe to call concurrently (per session: one at a time).
     */
    async ask(
      question: string,
      call: {
        onStep?: (step: InvestigationStep) => void
        /** Called with each data tool's result — the chat builds evidence cards from these. */
        onResult?: (step: InvestigationStep, result: unknown) => void
        sessionId?: string
      } = {},
    ): Promise<{ text: string; sessionId: string; steps: InvestigationStep[]; transcript: TranscriptEntry[]; error?: string }> {
      const sessionId = await startSession(call.sessionId)
      const steps: InvestigationStep[] = []
      const record = (step: InvestigationStep) => {
        steps.push(step)
        options.onStep?.(step)
        call.onStep?.(step)
      }
      const runner = new Runner({ agent: buildOrchestrator(record, (step, result) => call.onResult?.(step, result)), appName: APP_NAME, sessionService: sessions })
      const transcript: TranscriptEntry[] = []
      let text = ''
      let failure: string | undefined
      for await (const event of runner.runAsync({ userId: USER_ID, sessionId, newMessage: { role: 'user', parts: [{ text: question }] } })) {
        if (event.errorMessage) failure = event.errorMessage
        if (event.author !== 'orchestrator') continue
        for (const part of event.content?.parts ?? []) {
          if (part.functionCall) {
            const step = { agent: 'orchestrator', tool: part.functionCall.name ?? 'unknown', args: (part.functionCall.args ?? {}) as Record<string, unknown> }
            record(step)
            transcript.push({ kind: 'call', agent: step.tool, content: JSON.stringify(step.args) })
          }
          if (part.functionResponse) {
            transcript.push({ kind: 'result', agent: part.functionResponse.name ?? 'unknown', content: JSON.stringify(part.functionResponse.response ?? {}) })
          }
          if (part.text) {
            text = part.text
            transcript.push({ kind: 'text', agent: 'orchestrator', content: part.text })
          }
        }
      }
      // ADK swallows a model error inside a specialist: the orchestrator just gets an empty result and would write a
      // confident "no data found". When every specialist came back empty, say what really happened instead.
      const results = transcript.filter((t) => t.kind === 'result')
      const empty = results.filter((t) => isEmptyResult(t.content))
      if (results.length > 0 && empty.length === results.length) {
        const names = [...new Set(empty.map((t) => t.agent))].join(', ')
        return { text: '', sessionId, steps, transcript, error: failure ?? `the specialists (${names}) returned nothing — the model call inside them failed; the cause is in the observer's terminal` }
      }
      if (isLeakedToolCall(text)) {
        return { text: '', sessionId, steps, transcript, error: 'the agents did not finish the report (a tool call leaked instead) — the evidence cards above are still valid; ask again to continue' }
      }
      return { text, sessionId, steps, transcript, ...(failure ? { error: failure } : {}) }
    },
  }
}

export type Investigator = ReturnType<typeof createInvestigator>
