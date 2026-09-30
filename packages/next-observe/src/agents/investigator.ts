// Orchestrator + specialist agents (Four Golden Signals split) over the telemetry tools from next-observe/debug.
import { AgentTool, FunctionTool, InMemorySessionService, LlmAgent, Runner, type BaseLlm } from '@google/adk'
import { z } from 'zod'
import type { StorageAdapter } from '../collector/types.js'
import { createAgentQueries, type QueryOptions } from '../debug/queries.js'

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
}

const since = z.number().positive().optional().describe('look back this many minutes (default 15)')
const service = z.string().optional().describe('exact service name')
const operation = z.string().optional().describe('substring of the operation name, case-insensitive')

const FACTS_ONLY = `Use only facts returned by your tools; if a tool returned nothing relevant, say so — never guess causes.
Quote exact numbers, operation names, versions and error messages. Answer in English.`

const APP_NAME = 'next-observe'
const USER_ID = 'next-observe'

export function createInvestigator(options: InvestigatorOptions) {
  const q = createAgentQueries(options.storage, options.queryOptions)
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

    const tools = (agent: string) => ({
      services: tool(agent, 'get_services', 'Services, their deployed versions (in deploy order) and seconds since their last span.', z.object({}), () => q.getServices()),
      stats: tool(agent, 'get_operation_stats', 'Slowest operations by p95 with p50/p99 and error rate.', z.object({ service, operation, sinceMinutes: since }), (a) => q.getOperationStats(a)),
      versions: tool(agent, 'compare_versions', 'Latest deployed version vs the previous one per operation: p95 ratio and error-rate delta. Use it to name the deployment that caused a regression.', z.object({ service, operation, sinceMinutes: since }), (a) => q.compareVersions(a)),
      errors: tool(agent, 'get_errors', 'Failing operations: error rate, top exception messages, example trace ids.', z.object({ service, operation, sinceMinutes: since }), (a) => q.getErrors(a)),
      search: tool(agent, 'search_traces', 'Recent traces matching filters, to get example trace ids.', z.object({ service, operation, minDurationMs: z.number().optional(), hasError: z.boolean().optional(), sinceMinutes: since }), (a) => q.searchTraces(a)),
      trace: tool(agent, 'get_trace', 'One trace as a tree with self time, errors and code file paths; `repeated` lists ≥3 identical sibling calls (N+1).', z.object({ traceId: z.string().describe('32-char hex trace id from search_traces') }), (a) => q.getTrace(a)),
    })

    const latency = tools('latency_agent')
    const latencyAgent = new LlmAgent({
      name: 'latency_agent',
      description: 'Latency specialist: slow operations, p50/p95/p99, regressions between deployed versions, N+1 patterns.',
      model: options.model,
      instruction: `You are a latency specialist. Find what is slow and why.
  Check compare_versions for regressions between deployments. For a slow trace, use search_traces then get_trace: high selfMs points at the code file; "repeated" means N+1.
  When asked where time is spent, always open at least one trace with get_trace — aggregates don't show structure.
Distinguish external dependencies from internal code. Max 3 sentences. ${FACTS_ONLY}`,
      tools: [latency.stats, latency.versions, latency.search, latency.trace],
    })

    const error = tools('error_agent')
    const errorAgent = new LlmAgent({
      name: 'error_agent',
      description: 'Error specialist: failing operations, error rates, exact exception messages, source vs downstream victims.',
      model: options.model,
      instruction: `You are an error specialist. Report the failing operation, its error rate and the exact exception message.
  Use get_trace on an example trace to separate the source span from its downstream victims and to find the code file. Max 3 sentences. ${FACTS_ONLY}`,
      tools: [error.errors, error.search, error.trace],
    })

    const traffic = tools('traffic_agent')
    const trafficAgent = new LlmAgent({
      name: 'traffic_agent',
      description: 'Traffic specialist: which services report data, versions deployed, silent services (no traffic).',
      model: options.model,
      instruction: `You are a traffic specialist. A service that stopped sending spans is more critical than errors — flag it immediately.
  Report which versions are deployed and whether traffic looks normal. Max 2 sentences. ${FACTS_ONLY}`,
      tools: [traffic.services, traffic.stats],
    })

    const orchestrator = new LlmAgent({
      name: 'orchestrator',
      model: options.model,
      instruction: `You coordinate an investigation of a Next.js app using specialist agents.
  Slowness → latency_agent (then traffic_agent if needed). Failures → error_agent first, then latency_agent. "Nothing happens" → traffic_agent.
  A broad or unclear question → call all three. Then write one report for an on-call engineer at 3am:
  priority no-traffic > errors > latency, max 5 sentences, diagnosis only, never suggest automated fixes.
  Treat separate findings as separate problems unless a tool result shows they are connected. ${FACTS_ONLY}`,
      tools: [new AgentTool({ agent: latencyAgent }), new AgentTool({ agent: errorAgent }), new AgentTool({ agent: trafficAgent })],
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
      return { text, sessionId, steps, transcript, ...(failure ? { error: failure } : {}) }
    },
  }
}

export type Investigator = ReturnType<typeof createInvestigator>
