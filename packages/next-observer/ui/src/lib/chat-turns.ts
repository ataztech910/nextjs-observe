// The chat as data: turns (one question or one anomaly, with everything the AI agents did about it) and the words for
// the list of investigations. Pure, so it is tested without a browser.
import type { ChatEvent, ProactiveEvent } from '../../../src/collector/chat.js'
import type { StoredTurn } from '../../../src/collector/chat-history.js'
import type { Anomaly } from '../../../src/debug/detector.js'

export interface Turn {
  id: string
  /** The user's question, or the anomaly headline for a proactive turn. */
  question: string
  events: ChatEvent[]
  running: boolean
  /** Started by the detector or a failing check, not by a question. */
  proactive?: boolean
  /** When it started, by this browser's clock (an anomaly: when it was detected). */
  startedAtMs: number
}

export const isEnd = (e: ChatEvent) => e.type === 'report' || e.type === 'error' || e.type === 'stopped' || e.type === 'noted'

/** One event of a proactive turn, as it arrives over SSE: starts the turn or adds to it. */
export function applyProactive(turns: Turn[], envelope: Pick<ProactiveEvent, 'turnId' | 'event'>, options: { chatEnabled: boolean; headline: (anomaly: Anomaly) => string; nowMs: number }): Turn[] {
  const { turnId, event } = envelope
  const existing = turns.find((t) => t.id === turnId)
  const turn: Turn = existing ?? {
    id: turnId,
    question: event.type === 'anomaly' ? options.headline(event.anomaly) : 'Anomaly',
    events: [],
    // Without agents an anomaly is all there is — nothing keeps running.
    running: options.chatEnabled,
    proactive: true,
    startedAtMs: event.type === 'anomaly' ? event.anomaly.detectedAtMs : options.nowMs,
  }
  // A turn that has ended stays ended: a late event (the observer's own `stopped` after ours) does not revive it.
  const updated: Turn = { ...turn, events: [...turn.events, event], running: turn.running && !isEnd(event) }
  return existing ? turns.map((t) => (t.id === turnId ? updated : t)) : [...turns, updated]
}

/**
 * Turns the observer remembers, for a page that has just been opened. Turns already on the page win: they are the
 * same ones (same id), only fresher.
 */
export function withHistory(turns: Turn[], stored: StoredTurn[], headline: (anomaly: Anomaly) => string): Turn[] {
  const known = new Set(turns.map((t) => t.id))
  const restored = stored
    .filter((s) => !known.has(s.id))
    .map((s): Turn => {
      const anomaly = s.events.find((e): e is Extract<ChatEvent, { type: 'anomaly' }> => e.type === 'anomaly')?.anomaly
      return {
        id: s.id,
        question: s.question ?? (anomaly ? headline(anomaly) : 'Anomaly'),
        events: s.events,
        // A question restored from the history was asked by a page that is gone, and with it the request that kept the
        // investigation alive — whatever the observer still says, nobody is working on it.
        running: s.proactive && s.running,
        ...(s.proactive ? { proactive: true } : {}),
        startedAtMs: s.startedAtMs,
      }
    })
  return [...restored, ...turns]
}

/** Why the observer did not investigate an anomaly on its own — the line under it in the chat. */
export function notedText(event: Extract<ChatEvent, { type: 'noted' }>, formatTime: (ms: number) => string): string {
  const { limit, periodMs, nextAtMs } = event.budget
  const ask = 'ask in the chat to look into it'
  if (event.reason === 'queue') return `not investigated: enough investigations are already waiting — ${ask}`
  if (limit === 0) return `not investigated: the agents start investigations only when asked (OBSERVE_AUTO_INVESTIGATIONS=0) — ${ask}`
  const next = nextAtMs === null ? '' : `, next at ${formatTime(nextAtMs)}`
  return `not investigated: ${limit} of ${limit} investigation${limit === 1 ? '' : 's'} on their own used in the last ${periodMs / 60_000} min${next} — ${ask}`
}

export type TurnState = 'running' | 'answered' | 'stopped' | 'failed' | 'noted'

export interface TurnSummary {
  id: string
  title: string
  kind: 'anomaly' | 'question'
  state: TurnState
  /** An anomaly's severity; a question has none. */
  severity?: Anomaly['severity']
  startedAtMs: number
}

/** A line of the investigations list. */
export function summarize(turn: Turn): TurnSummary {
  const anomaly = turn.events.find((e): e is Extract<ChatEvent, { type: 'anomaly' }> => e.type === 'anomaly')?.anomaly
  const has = (type: ChatEvent['type']) => turn.events.some((e) => e.type === type)
  // `noted`: an anomaly with nobody to look into it (no agents, or the turn ended with nothing said).
  const state: TurnState = turn.running ? 'running' : has('report') ? 'answered' : has('stopped') ? 'stopped' : has('error') ? 'failed' : 'noted'
  return { id: turn.id, title: turn.question, kind: turn.proactive ? 'anomaly' : 'question', state, ...(anomaly ? { severity: anomaly.severity } : {}), startedAtMs: turn.startedAtMs }
}

/** Newest first — the list reads like an inbox. */
export function investigations(turns: Turn[]): TurnSummary[] {
  return turns.map(summarize).sort((a, b) => b.startedAtMs - a.startedAtMs)
}

/** The turn on screen: the one picked, else the latest one. */
/** Selected by "New chat": no conversation is shown until the next question — the list stays where it is. */
export const NEW_CHAT = 'new-chat'

export function shownTurn(turns: Turn[], selectedId: string | null): Turn | undefined {
  if (selectedId === NEW_CHAT) return undefined
  return turns.find((t) => t.id === selectedId) ?? [...turns].sort((a, b) => b.startedAtMs - a.startedAtMs)[0]
}
