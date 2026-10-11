// What the chat has been through, kept by the observer: questions asked and investigations it started on its own.
// A page that is reloaded (or opened on another machine) gets them back — the browser used to be their only home.
// In memory, like the traces: a restart of the observer starts clean.
import { isTurnEnd as isEnd, type ChatEvent } from './chat.js'

export interface StoredTurn {
  id: string
  /** The question asked; absent for a turn the observer started — its first event is the anomaly. */
  question?: string
  proactive: boolean
  startedAtMs: number
  events: ChatEvent[]
  /** False once it ended — with a report, an error, a stop, or simply because nobody was left to answer. */
  running: boolean
}

export interface ChatHistoryOptions {
  /** Turns kept; the oldest go first. Default 100. */
  maxTurns?: number
  /** Events kept per turn (steps of a long investigation). Default 200 — a page gets the whole history when it opens. */
  maxEvents?: number
}

export class ChatHistory {
  private readonly turns = new Map<string, StoredTurn>()
  private readonly maxTurns: number
  private readonly maxEvents: number

  constructor(options: ChatHistoryOptions = {}) {
    this.maxTurns = Math.max(1, options.maxTurns ?? 100)
    this.maxEvents = Math.max(1, options.maxEvents ?? 200)
  }

  /** Begins a turn. An id already known is left as it is: the same question is not recorded twice. */
  start(turn: Pick<StoredTurn, 'id' | 'proactive' | 'startedAtMs'> & { question?: string; running?: boolean }): void {
    if (this.turns.has(turn.id)) return
    this.turns.set(turn.id, { id: turn.id, ...(turn.question === undefined ? {} : { question: turn.question }), proactive: turn.proactive, startedAtMs: turn.startedAtMs, events: [], running: turn.running ?? true })
    while (this.turns.size > this.maxTurns) this.turns.delete(this.turns.keys().next().value as string)
  }

  /** Adds an event to a turn; one that ends the turn stops it. An unknown (already dropped) turn is ignored. */
  add(id: string, event: ChatEvent): void {
    const turn = this.turns.get(id)
    if (!turn) return
    // The end of a turn is never the event to drop: a long investigation loses its middle steps, not its report.
    if (turn.events.length >= this.maxEvents && !isEnd(event)) return
    turn.events.push(event)
    if (isEnd(event)) turn.running = false
  }

  /** The turn is over, whatever its last event was (the asker's connection closed, the handler returned). */
  end(id: string): void {
    const turn = this.turns.get(id)
    if (turn) turn.running = false
  }

  has(id: string): boolean {
    return this.turns.has(id)
  }

  /** Oldest first. Copies: what the caller does with them does not reach the history. */
  list(): StoredTurn[] {
    return [...this.turns.values()].map((turn) => ({ ...turn, events: [...turn.events] }))
  }
}
