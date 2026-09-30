import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, type ChatEvent } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EvidenceCardView } from '@/components/chat/evidence-cards'
import { Input } from '@/components/ui/input'
import { renderInline } from '@/lib/inline-markdown'

// The three workshop scenarios, one click away.
const SUGGESTIONS = [
  "Checkout is slow. What's causing it and which deployment introduced it?",
  'There are 500 errors on product pages. Which operation is failing and why?',
  'The product catalog is slower than expected but no single span stands out. What is wrong?',
]

interface Turn {
  id: number
  question: string
  events: ChatEvent[]
  running: boolean
}

export function ChatPage() {
  const info = useQuery({ queryKey: ['chat-info'], queryFn: api.chatInfo })
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  // The agents remember the conversation per session; the id arrives with the first `status` event.
  const [sessionId, setSessionId] = useState<string>()
  const running = turns.some((t) => t.running)

  async function ask(question: string) {
    const id = Date.now()
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

  function newChat() {
    setTurns([])
    setSessionId(undefined)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft.trim() && !running) void ask(draft.trim())
  }

  if (info.data && !info.data.enabled) {
    return (
      <Card className="max-w-2xl" data-testid="chat-disabled">
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">Chat is disabled</p>
          <p className="text-muted-foreground">{info.data.reason}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Ask the agents</h1>
        {info.data?.enabled && (
          <Badge variant={info.data.mode === 'mock' ? 'outline' : 'secondary'} data-testid="chat-mode">
            {info.data.mode === 'mock' ? 'MOCK — no real model' : 'REAL model'}
          </Badge>
        )}
        {turns.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={newChat} disabled={running}>
            New chat
          </Button>
        )}
      </div>

      {turns.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={() => void ask(s)} disabled={running}>
              {s}
            </Button>
          ))}
        </div>
      )}

      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}

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
  const steps = turn.events.filter((e): e is Extract<ChatEvent, { type: 'step' }> => e.type === 'step')
  const cards = turn.events.flatMap((e) => (e.type === 'card' ? [e.card] : []))
  const report = turn.events.find((e): e is Extract<ChatEvent, { type: 'report' }> => e.type === 'report')
  const error = turn.events.find((e): e is Extract<ChatEvent, { type: 'error' }> => e.type === 'error')
  return (
    <div className="space-y-2" data-testid="chat-turn">
      <div className="ml-auto w-fit max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{turn.question}</div>
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
            {turn.running && <li className="animate-pulse">working…</li>}
          </ol>
          {cards.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="chat-cards">
              {cards.map((card, i) => (
                <EvidenceCardView key={i} card={card} />
              ))}
            </div>
          )}
          {report && (
            <p className="whitespace-pre-wrap leading-relaxed" data-testid="chat-report">
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
    </div>
  )
}
