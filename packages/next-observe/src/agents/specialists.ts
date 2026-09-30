// Specialists as data: name, description, instruction and which telemetry tools they may use. The built-in three are
// defaults; a project can replace one (same name) or add its own in observe.agents.ts — the workshop's "write your agent".

export const TOOL_NAMES = ['get_services', 'get_operation_stats', 'compare_versions', 'get_errors', 'search_traces', 'get_trace'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export interface SpecialistSpec {
  /** snake_case, becomes the tool name the orchestrator calls. */
  name: string
  /** What this specialist is for — the orchestrator picks specialists by it. */
  description: string
  /** How the specialist works. Facts-only, own-tools-only and English rules are appended automatically. */
  instruction: string
  tools: ToolName[]
}

const NAME = /^[a-z][a-z0-9_]{1,40}$/

/** Validates a specialist; use it in observe.agents.ts for type checking and early, readable errors. */
export function defineSpecialist(spec: SpecialistSpec): SpecialistSpec {
  const where = typeof spec?.name === 'string' ? `specialist "${spec.name}"` : 'specialist'
  if (typeof spec !== 'object' || spec === null) throw new Error('a specialist must be an object')
  if (typeof spec.name !== 'string' || !NAME.test(spec.name)) throw new Error(`${where}: name must be snake_case (a-z, 0-9, _), 2–41 characters`)
  if (spec.name === 'orchestrator') throw new Error(`${where}: "orchestrator" is reserved`)
  for (const field of ['description', 'instruction'] as const) {
    if (typeof spec[field] !== 'string' || !spec[field].trim()) throw new Error(`${where}: ${field} must be a non-empty string`)
  }
  if (!Array.isArray(spec.tools) || spec.tools.length === 0) throw new Error(`${where}: tools must list at least one of ${TOOL_NAMES.join(', ')}`)
  const unknown = spec.tools.filter((t) => !(TOOL_NAMES as readonly string[]).includes(t))
  if (unknown.length) throw new Error(`${where}: unknown tools ${unknown.join(', ')} — available: ${TOOL_NAMES.join(', ')}`)
  return { name: spec.name, description: spec.description.trim(), instruction: spec.instruction.trim(), tools: [...new Set(spec.tools)] }
}

export const BUILT_IN_SPECIALISTS: SpecialistSpec[] = [
  {
    name: 'latency_agent',
    description: 'Latency specialist: slow operations, p50/p95/p99, regressions between deployed versions, N+1 patterns.',
    instruction: `You are a latency specialist. Find what is slow and why.
Check compare_versions for regressions between deployments. For a slow trace, use search_traces then get_trace: high selfMs points at the code file; "repeated" means N+1.
When asked where time is spent, always open at least one trace with get_trace — aggregates don't show structure.
Distinguish external dependencies from internal code. Max 3 sentences.`,
    tools: ['get_operation_stats', 'compare_versions', 'search_traces', 'get_trace'],
  },
  {
    name: 'error_agent',
    description: 'Error specialist: failing operations, error rates, exact exception messages, source vs downstream victims.',
    instruction: `You are an error specialist. Report the failing operation, its error rate and the exact exception message.
Use get_trace on an example trace to separate the source span from its downstream victims and to find the code file. Max 3 sentences.`,
    tools: ['get_errors', 'search_traces', 'get_trace'],
  },
  {
    name: 'traffic_agent',
    description: 'Traffic specialist: which services report data, versions deployed, silent services (no traffic).',
    instruction: `You are a traffic specialist. A service that stopped sending spans is more critical than errors — flag it immediately.
Report which versions are deployed and whether traffic looks normal. Max 2 sentences.`,
    tools: ['get_services', 'get_operation_stats'],
  },
]

/** Project specialists replace built-ins with the same name and are appended otherwise. */
export function mergeSpecialists(builtIn: SpecialistSpec[], project: SpecialistSpec[]): SpecialistSpec[] {
  const byName = new Map(builtIn.map((s) => [s.name, s]))
  for (const spec of project) byName.set(spec.name, spec)
  return [...byName.values()]
}

export const FACTS_ONLY = `Use only facts returned by your tools; if a tool returned nothing relevant, say so — never guess causes.
Quote exact numbers, operation names, versions and error messages. Answer in English.`

// Specialists run behind AgentTool with their own tools only; calling another agent from inside one cannot work.
export const OWN_TOOLS_ONLY = `You can only use the tools listed for you — never call other agents or tools that are not listed.
If you need data your tools cannot give, say what is missing in your answer.`

export function specialistInstruction(spec: SpecialistSpec): string {
  return `${spec.instruction}\n${FACTS_ONLY}\n${OWN_TOOLS_ONLY}`
}

export function orchestratorInstruction(specialists: SpecialistSpec[]): string {
  const list = specialists.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return `You coordinate an investigation of a Next.js app using these specialist agents:
${list}
Pick the specialists whose descriptions fit the question: failures first to the error specialist, slowness to the latency specialist,
"nothing happens" to the traffic specialist. A broad or unclear question → call all of them. Then write one report for an
on-call engineer at 3am: priority no-traffic > errors > latency, max 5 sentences, diagnosis only, never suggest automated fixes.
Treat separate findings as separate problems unless a tool result shows they are connected. ${FACTS_ONLY}`
}
