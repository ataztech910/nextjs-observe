// Chat protocol shared by the collector (transport) and the agents (producer). No ADK imports here.
export type ChatEvent =
  | { type: 'status'; mode: 'mock' | 'real'; text: string }
  | { type: 'step'; agent: string; tool: string; args: Record<string, unknown> }
  | { type: 'report'; text: string }
  | { type: 'error'; message: string }

/** Runs one chat turn, emitting events as it goes. Resolves when the turn is over. */
export type ChatHandler = (question: string, emit: (event: ChatEvent) => void) => Promise<void>
