// Chat protocol shared by the collector (transport) and the agents (producer). No ADK imports here.
import type { Anomaly } from '../debug/detector.js'

export interface VersionStats {
  version: string
  count: number
  p50Ms: number
  p95Ms: number
  errorRate: number
}

/**
 * Evidence cards are built by code from tool results — never written by the model — so they can't contain
 * invented facts. The model writes the narrative report; the cards show the proof.
 */
export type EvidenceCard =
  | { kind: 'regression'; service: string; operation: string; from: VersionStats; to: VersionStats; p95Ratio: number | null; errorRateDelta: number }
  | { kind: 'errors'; service: string; operation: string; errorRate: number | null; errors: number; message: string; traceIds: string[] }
  | { kind: 'n-plus-one'; traceId: string; parent: string; operation: string; count: number; totalMs: number }
  | { kind: 'hotspot'; traceId: string; operation: string; selfMs: number; traceMs: number; codeFile: string }
  | { kind: 'silent'; service: string; lastSpanSecondsAgo: number }
  /** The app's own checks of its answers, per deployed version: where wrong data started and how often it happens. */
  | { kind: 'wrong-data'; service: string; operation: string; versions: { version: string; checked: number; failed: number }[] }
  | { kind: 'traces'; label: string; traces: { traceId: string; root: string; durationMs: number; errors: number }[] }

export type ChatEvent =
  | { type: 'anomaly'; anomaly: Anomaly }
  | { type: 'status'; mode: 'mock' | 'real'; sessionId: string; text: string }
  | { type: 'step'; agent: string; tool: string; args: Record<string, unknown> }
  | { type: 'card'; card: EvidenceCard }
  | { type: 'report'; text: string }
  /** Somebody stopped the investigation; what was found until then stays on the page. */
  | { type: 'stopped'; closed?: true }
  /**
   * `closed`: this conversation cannot be continued (it was stopped or timed out, so its history ends in the middle of
   * a step) — the next question has to start a new one. The observer says so; the client does not have to guess.
   */
  | { type: 'error'; message: string; closed?: true }

/** The events after which a turn is over. One definition for the observer's history and for the page. */
export const isTurnEnd = (event: ChatEvent): boolean => event.type === 'report' || event.type === 'error' || event.type === 'stopped'

export interface ChatRequest {
  question: string
  /** From a previous `status` event: continue that conversation. Omitted → a new conversation. */
  sessionId?: string
  /** Aborted when somebody stops the investigation (the Stop button, or the asker went away). */
  signal?: AbortSignal
}

/** Runs one chat turn, emitting events as it goes. Resolves when the turn is over. */
export type ChatHandler = (request: ChatRequest, emit: (event: ChatEvent) => void) => Promise<void>

/** Server-pushed (SSE) event: part of a proactive turn started by the detector, not by a question. */
export interface ProactiveEvent {
  /** Increases by one per event; lets a reconnecting client skip the replayed ones it already has. */
  seq: number
  turnId: string
  event: ChatEvent
}
