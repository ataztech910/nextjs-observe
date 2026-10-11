// The chat's state lives here, outside the page: leaving for a trace and coming back must not lose the questions asked
// or drop the live feed of the observer's own investigations.
import { api, type ChatEvent, type ProactiveEvent, type StoredTurn } from '@/api'
import { anomalyHeadline } from '@/components/chat/anomaly-view'
import { applyProactive, followedElsewhere, withHistory, type Turn } from './chat-turns'

interface ChatState {
  turns: Turn[]
  /** The agents remember the conversation per session; the id arrives with the first `status` event. */
  sessionId?: string
  /** The turn the user picked from the list; null = follow the latest. */
  selectedId: string | null
}

let state: ChatState = { turns: [], selectedId: null }
const listeners = new Set<() => void>()
const set = (change: (current: ChatState) => ChatState) => {
  state = change(state)
  for (const listener of listeners) listener()
}
const updateTurn = (id: string, change: (turn: Turn) => Turn) => set((s) => ({ ...s, turns: s.turns.map((t) => (t.id === id ? change(t) : t)) }))

/** One way to stop per question asked here: closing its request is what tells the observer to stop. */
const asking = new Map<string, AbortController>()
let chatEnabled = false
let source: EventSource | undefined

const userIsAsking = () => state.turns.some((t) => t.running && !t.proactive)

let listening = false
/** Questions this page did not ask itself: it knows them only from the observer's history. */
const restoredQuestions = new Set<string>()
/** Every question this page asked itself — the observer's copy of those is never taken over the page's own. */
const asked = new Set<string>()
/** Sessions of the observer's own investigations, by turn — the next question continues the one that just ended. */
const proactiveSessions = new Map<string, string>()
const FOLLOW_ELSEWHERE_MS = 3000

/**
 * Once per page load: first what the observer remembers (questions asked before a reload, investigations of its own),
 * then the live feed of proactive turns from where that history ends. The feed stays open while the app does.
 */
function listen() {
  if (listening) return
  listening = true
  void api
    .chatHistory()
    .then(
      (history) => {
        for (const turn of history.turns) {
          // The stream will not repeat what the history already holds — the session of a running investigation included.
          const status = turn.events.find((e) => e.type === 'status')
          if (turn.proactive && status?.type === 'status') proactiveSessions.set(turn.id, status.sessionId)
        }
        takeHistory(history.turns)
        followElsewhere()
        return history.seq
      },
      // An observer too old to keep a history, or unreachable right now: the live feed alone, as before.
      () => 0,
    )
    .then(follow)
}

/**
 * Puts what the observer remembers onto the page. Every time, not only on the first load: a question asked elsewhere
 * can turn up in any answer, and only one that is marked as "not ours" is refreshed by the next.
 */
function takeHistory(stored: StoredTurn[]) {
  for (const turn of stored) if (!turn.proactive && !asked.has(turn.id)) restoredQuestions.add(turn.id)
  set((s) => ({ ...s, turns: withHistory(s.turns, stored, anomalyHeadline, restoredQuestions) }))
}

/** A question being answered for another tab sends this page nothing; while there is one, ask the observer again. */
function followElsewhere() {
  if (!followedElsewhere(state.turns, restoredQuestions)) return
  setTimeout(() => {
    void api.chatHistory().then(
      (history) => {
        takeHistory(history.turns)
        followElsewhere()
      },
      () => followElsewhere(),
    )
  }, FOLLOW_ELSEWHERE_MS)
}

function follow(fromSeq: number) {
  let lastSeq = fromSeq
  const sessions = proactiveSessions
  source = new EventSource('/api/chat/events')
  source.onmessage = (message) => {
    const { seq, turnId, event } = JSON.parse(message.data) as ProactiveEvent
    if (seq <= lastSeq) return // replayed after a reconnect
    lastSeq = seq
    if (event.type === 'status') sessions.set(turnId, event.sessionId)
    set((s) => ({ ...s, turns: applyProactive(s.turns, { turnId, event }, { chatEnabled, headline: anomalyHeadline, nowMs: Date.now() }) }))
    // When a proactive investigation ends, the next question continues it ("why?", "since when?").
    const finished = sessions.get(turnId)
    if (event.type === 'report' && finished && !userIsAsking()) set((s) => ({ ...s, sessionId: finished }))
  }
}

async function ask(question: string) {
  const id = `q-${Date.now()}`
  const controller = new AbortController()
  asked.add(id)
  asking.set(id, controller)
  // The turn just asked is the one to look at.
  set((s) => ({ ...s, selectedId: id, turns: [...s.turns, { id, question, events: [], running: true, startedAtMs: Date.now() }] }))
  // The observer says when a conversation cannot be continued (stopped, timed out); our own Stop closes it too.
  let closed = false
  let lost = false
  try {
    await api.ask(
      question,
      state.sessionId,
      (event) => {
        if (event.type === 'status') set((s) => ({ ...s, sessionId: event.sessionId }))
        if ((event.type === 'error' || event.type === 'stopped') && event.closed) closed = true
        updateTurn(id, (t) => ({ ...t, events: [...t.events, event] }))
      },
      controller.signal,
      id,
    )
  } catch (error) {
    // Our own Stop closes the request; that is not a failure to report.
    const event: ChatEvent = controller.signal.aborted ? { type: 'stopped' } : { type: 'error', message: error instanceof Error ? error.message : String(error) }
    lost = !controller.signal.aborted
    updateTurn(id, (t) => ({ ...t, events: [...t.events, event] }))
  } finally {
    asking.delete(id)
    // A lost connection stops the investigation on the observer's side as well, so that closes it too.
    if (closed || controller.signal.aborted || lost) set((s) => ({ ...s, sessionId: undefined }))
    updateTurn(id, (t) => ({ ...t, running: false }))
  }
}

function stop(turn: Turn) {
  // Our own question: closing its request is the stop.
  const own = asking.get(turn.id)
  if (own) return void own.abort()
  // Anything else — the observer's own investigation, or a question asked elsewhere — is stopped by the observer,
  // which then says so to everyone watching.
  void api.stopInvestigation(turn.id).then((result) => {
    if (result === 'stopped') return
    // Nothing to stop, or nobody to ask: either way no event will ever end this turn — end it here, and say which.
    const event: ChatEvent = result === 'gone' ? { type: 'stopped' } : { type: 'error', message: 'could not reach the observer to stop this — it may still be running' }
    updateTurn(turn.id, (t) => (t.running ? { ...t, running: false, events: [...t.events, event] } : t))
  })
}

export const chatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
  get: () => state,
  /** Whether agents answer here — decides if an anomaly without a report yet counts as running. */
  setEnabled(enabled: boolean) {
    chatEnabled = enabled
  },
  listen,
  ask,
  stop,
  select: (id: string | null) => set((s) => ({ ...s, selectedId: id })),
  /** The next question starts a new conversation; the investigations so far stay in the list. */
  newConversation: () => set((s) => ({ ...s, sessionId: undefined, selectedId: null })),
}
