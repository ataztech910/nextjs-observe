// Types for observe.agents.ts — the project's own specialists for the next-observer observer. No AI dependencies here: the app only
// describes its specialists; next-observer (run with `npx next-observer dev`) loads the file, validates it and runs the agents.

/** Telemetry tools a specialist can use. Kept in sync with next-observer (a test there compares the lists). */
export const TOOL_NAMES = ['get_services', 'get_operation_stats', 'compare_versions', 'get_errors', 'search_traces', 'get_trace'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export interface SpecialistSpec {
  /** snake_case. Same name as a built-in (latency_agent, error_agent, traffic_agent) replaces it; a new name adds one. */
  name: string
  /** What this specialist is for — the orchestrator picks specialists by it. */
  description: string
  /** How the specialist works. "Facts from tools only" and "own tools only" rules are added by next-observer. */
  instruction: string
  tools: ToolName[]
}

/** Gives observe.agents.ts type checking; next-observer validates the specialists when it loads the file. */
export function defineSpecialist(spec: SpecialistSpec): SpecialistSpec {
  return spec
}
