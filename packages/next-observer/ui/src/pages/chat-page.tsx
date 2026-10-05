import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type ChatEvent, type ProactiveEvent } from '@/api'
import { AnomalyView, anomalyHeadline } from '@/components/chat/anomaly-view'
import { EvidenceCardView } from '@/components/chat/evidence-cards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/page-header'
import { renderInline } from '@/lib/inline-markdown'

// The three workshop scenarios, one click away.
const SUGGESTIONS = [
  "Checkout is slow. What's causing it and which deployment introduced it?",
  'There are 500 errors on product pages. Which operation is failing and why?',
  'The product catalog is slower than expected but no single span stands out. What is wrong?',
]

interface Turn {
  id: string
  /** The user's question, or the anomaly headline for a proactive turn. */
  question: string
  events: ChatEvent[]
  running: boolean
  /** Started by the detector, not by a question. */
  proactive?: boolean
}

const chatRoute = getRouteApi('/chat')

const isEnd = (e: ChatEvent) => e.type === 'report' || e.type === 'error'

export function ChatPage() {
  const info = useQuery({ queryKey: ['chat-info'], queryFn: api.chatInfo })
  const chatEnabled = info.data?.enabled ?? false
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  // The agents remember the conversation per session; the id arrives with the first `status` event.
  const [sessionId, setSessionId] = useState<string>()
  // Only the user's own questions block the input; a proactive investigation runs alongside.
  const running = turns.some((t) => t.running && !t.proactive)
  const runningRef = useRef(running)
  runningRef.current = running
  const chatEnabledRef = useRef(chatEnabled)
  chatEnabledRef.current = chatEnabled

  // Proactive turns: the detector found an anomaly and the agents investigate without being asked.
  useEffect(() => {
    let lastSeq = 0
    const proactiveSessions = new Map<string, string>()
    const source = new EventSource('/api/chat/events')
    source.onmessage = (message) => {
      const { seq, turnId, event } = JSON.parse(message.data) as ProactiveEvent
      if (seq <= lastSeq) return // replayed after a reconnect
      lastSeq = seq
      if (event.type === 'status') proactiveSessions.set(turnId, event.sessionId)
      setTurns((all) => {
        const existing = all.find((t) => t.id === turnId)
        const turn: Turn = existing ?? {
          id: turnId,
          question: event.type === 'anomaly' ? anomalyHeadline(event.anomaly) : 'Anomaly',
          events: [],
          // Without agents an anomaly is all there is — nothing keeps running.
          running: chatEnabledRef.current,
          proactive: true,
        }
        const updated: Turn = {
          ...turn,
          events: [...turn.events, event],
          running: turn.running && !isEnd(event),
        }
        return existing ? all.map((t) => (t.id === turnId ? updated : t)) : [...all, updated]
      })
      // When a proactive investigation ends, the next question continues it ("why?", "since when?").
      const finishedSession = proactiveSessions.get(turnId)
      if (event.type === 'report' && finishedSession && !runningRef.current) setSessionId(finishedSession)
    }
    return () => source.close()
  }, [])

  async function ask(question: string) {
    const id = `q-${Date.now()}`
    const update = (fn: (turn: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)))
    setTurns((all) => [...all, { id, question, events: [], running: true }])
    setDraft('')
    try {
      await api.ask(question, sessionId, (event) => {
        if (event.type === 'status') setSessionId(event.sessionId)
        update((t) => ({ ...t, events: [...t.events, event] }))
      })
    } catch (error) {
      update((t) => ({ ...t, events: [...t.events, { type: 'error', message: error instanceof Error ? error.message : String(error) }] }))
    } finally {
      update((t) => ({ ...t, running: false }))
    }
  }

  // A question handed over in the URL (?ask=…, from the regression banner) is sent once, then removed from the URL so
  // a reload or the back button does not ask it again.
  const { ask: handedOver } = chatRoute.useSearch()
  const navigate = useNavigate({ from: '/chat' })
  const sentRef = useRef<string>(undefined)
  useEffect(() => {
    if (!handedOver || !chatEnabled || sentRef.current === handedOver) return
    sentRef.current = handedOver
    void navigate({ search: {}, replace: true })
    void ask(handedOver)
  }, [handedOver, chatEnabled])

  function newChat() {
    setTurns([])
    setSessionId(undefined)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft.trim() && !running) void ask(draft.trim())
  }

  const feed = turns.map((turn) => <TurnView key={turn.id} turn={turn} />)

  if (info.data && !info.data.enabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card data-testid="chat-disabled">
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">Chat is disabled</p>
            <p className="text-muted-foreground">{info.data.reason}</p>
          </CardContent>
        </Card>
        {feed}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Ask the agents" subtitle="They read your traces with tools — every fact comes from the data.">
        {info.data?.enabled && (
          <Badge variant={info.data.mode === 'mock' ? 'outline' : 'secondary'} className="font-mono" data-testid="chat-mode">
            {info.data.mode === 'mock' ? 'MOCK — no real model' : 'REAL model'}
          </Badge>
        )}
        {turns.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={newChat} disabled={running}>
            New chat
          </Button>
        )}
      </PageHeader>

      {turns.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} type="button" variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left font-normal" onClick={() => void ask(s)} disabled={running}>
              {s}
            </Button>
          ))}
        </div>
      )}

      {feed}

      <form onSubmit={submit} className="flex gap-2">
        <Input aria-label="Question" placeholder="Why is checkout slow?" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={running} />
        <Button type="submit" disabled={running || !draft.trim()}>
          {running ? 'Investigating…' : 'Ask'}
        </Button>
      </form>
    </div>
  )
}

function TurnView({ turn }: { turn: Turn }) {
  const anomaly = turn.events.find((e): e is Extract<ChatEvent, { type: 'anomaly' }> => e.type === 'anomaly')
  const steps = turn.events.filter((e): e is Extract<ChatEvent, { type: 'step' }> => e.type === 'step')
  const cards = turn.events.flatMap((e) => (e.type === 'card' ? [e.card] : []))
  const report = turn.events.find((e): e is Extract<ChatEvent, { type: 'report' }> => e.type === 'report')
  const error = turn.events.find((e): e is Extract<ChatEvent, { type: 'error' }> => e.type === 'error')
  const hasBody = steps.length > 0 || cards.length > 0 || report || error || turn.running
  return (
    <div className="space-y-2" data-testid="chat-turn" data-proactive={turn.proactive ? 'true' : undefined}>
      {anomaly ? (
        <AnomalyView anomaly={anomaly.anomaly} />
      ) : (
        <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{turn.question}</div>
      )}
      {hasBody && (
        <Card>
          <CardContent className="space-y-3 text-sm">
            <ol className="space-y-1 font-mono text-xs text-muted-foreground" data-testid="chat-steps">
              {steps.map((s, i) => (
                <li key={i}>
                  <span className={s.agent === 'orchestrator' ? 'text-foreground' : 'pl-4'}>
                    {s.agent} → {s.tool}
                  </span>
                  {Object.keys(s.args).length > 0 && <span className="ml-1 opacity-70">{JSON.stringify(s.args).slice(0, 120)}</span>}
                </li>
              ))}
              {turn.running && <li className="animate-pulse">{turn.proactive ? 'agents are investigating on their own…' : 'working…'}</li>}
            </ol>
            {cards.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2" data-testid="chat-cards">
                {cards.map((card, i) => (
                  <EvidenceCardView key={i} card={card} />
                ))}
              </div>
            )}
            {report && (
              <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]" data-testid="chat-report">
                {renderInline(report.text)}
              </p>
            )}
            {error && (
              <p className="text-destructive" data-testid="chat-error">
                {error.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
