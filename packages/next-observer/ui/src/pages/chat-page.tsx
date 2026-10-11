import { useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { api, type ChatEvent } from '@/api'
import { AnomalyView } from '@/components/chat/anomaly-view'
import { CopyPrompt } from '@/components/copy-prompt'
import { EvidenceCardView } from '@/components/chat/evidence-cards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/page-header'
import { reportPrompt } from '@/lib/agent-prompt'
import { chatStore } from '@/lib/chat-store'
import { investigations, shownTurn, type Turn, type TurnState } from '@/lib/chat-turns'
import { renderInline } from '@/lib/inline-markdown'

// The three workshop scenarios, one click away.
const SUGGESTIONS = [
  "Checkout is slow. What's causing it and which deployment introduced it?",
  'There are 500 errors on product pages. Which operation is failing and why?',
  'The product catalog is slower than expected but no single span stands out. What is wrong?',
]

const chatRoute = getRouteApi('/chat')

// Red only for what failed; an anomaly being looked into is the signal colour, a warning amber — as everywhere else.
const STATE: Record<TurnState, { label: string; tone: string }> = {
  running: { label: 'investigating', tone: 'text-signal' },
  answered: { label: 'report', tone: 'text-muted-foreground' },
  stopped: { label: 'stopped', tone: 'text-muted-foreground' },
  failed: { label: 'failed', tone: 'text-destructive' },
  noted: { label: 'noted', tone: 'text-muted-foreground' },
}

export function ChatPage() {
  const info = useQuery({ queryKey: ['chat-info'], queryFn: api.chatInfo })
  const chatEnabled = info.data?.enabled ?? false
  const { turns, selectedId } = useSyncExternalStore(chatStore.subscribe, chatStore.get)
  const [draft, setDraft] = useState('')
  // Only the user's own questions block the input; a proactive investigation runs alongside.
  const running = turns.some((t) => t.running && !t.proactive)

  useEffect(() => {
    chatStore.setEnabled(chatEnabled)
  }, [chatEnabled])
  // Proactive turns: the detector found an anomaly and the agents investigate without being asked.
  useEffect(() => chatStore.listen(), [])

  const ask = (question: string) => {
    setDraft('')
    void chatStore.ask(question)
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
    ask(handedOver)
  }, [handedOver, chatEnabled])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft.trim() && !running) ask(draft.trim())
  }

  const list = investigations(turns)
  const shown = shownTurn(turns, selectedId)

  const sidebar = list.length > 0 && (
    <nav aria-label="Investigations" className="space-y-1 lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto" data-testid="investigations">
      <p className="px-2 pb-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Investigations · {list.length}</p>
      {list.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === shown?.id ? 'true' : undefined}
          onClick={() => chatStore.select(item.id)}
          className="block w-full rounded-lg border border-transparent px-2 py-1.5 text-left hover:bg-muted/50 aria-[current=true]:border-border aria-[current=true]:bg-muted"
          data-testid="investigation"
          data-state={item.state}
        >
          <span className="line-clamp-2 text-sm">{item.title}</span>
          <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className={item.kind === 'anomaly' ? (item.severity === 'critical' ? 'text-destructive' : 'text-warning') : ''}>{item.kind === 'anomaly' ? (item.severity ?? 'anomaly') : 'question'}</span>
            <span className={`${STATE[item.state].tone} ${item.state === 'running' ? 'animate-pulse' : ''}`}>{STATE[item.state].label}</span>
            <span className="ml-auto tabular-nums">{new Date(item.startedAtMs).toLocaleTimeString()}</span>
          </span>
        </button>
      ))}
    </nav>
  )

  const turn = shown && <TurnView key={shown.id} turn={shown} onStop={() => chatStore.stop(shown)} />

  if (info.data && !info.data.enabled) {
    return (
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div>{sidebar}</div>
        <div className="space-y-4">
          <Card data-testid="chat-disabled">
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">Chat is disabled</p>
              <p className="text-muted-foreground">{info.data.reason}</p>
            </CardContent>
          </Card>
          {turn}
        </div>
      </div>
    )
  }

  return (
    <div className={`mx-auto grid gap-6 ${sidebar ? 'max-w-6xl lg:grid-cols-[18rem_minmax(0,1fr)]' : 'max-w-3xl'}`}>
      {sidebar && <div>{sidebar}</div>}
      <div className="min-w-0 space-y-6">
        <PageHeader title="Ask the agents" subtitle="They read your traces with tools — every fact comes from the data.">
          {info.data?.enabled && (
            <Badge variant={info.data.mode === 'mock' ? 'outline' : 'secondary'} className="font-mono" data-testid="chat-mode">
              {info.data.mode === 'mock' ? 'MOCK — no real model' : 'REAL model'}
            </Badge>
          )}
          {turns.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={chatStore.newConversation} disabled={running} title="The next question starts a new conversation; the investigations stay in the list">
              New chat
            </Button>
          )}
        </PageHeader>

        {turns.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s} type="button" variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left font-normal" onClick={() => ask(s)} disabled={running}>
                {s}
              </Button>
            ))}
          </div>
        )}

        {turn}

        <form onSubmit={submit} className="flex gap-2">
          <Input aria-label="Question" placeholder="Why is checkout slow?" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={running} />
          <Button type="submit" disabled={running || !draft.trim()}>
            {running ? 'Investigating…' : 'Ask'}
          </Button>
        </form>
      </div>
    </div>
  )
}

function TurnView({ turn, onStop }: { turn: Turn; onStop: () => void }) {
  const anomaly = turn.events.find((e): e is Extract<ChatEvent, { type: 'anomaly' }> => e.type === 'anomaly')
  const steps = turn.events.filter((e): e is Extract<ChatEvent, { type: 'step' }> => e.type === 'step')
  const cards = turn.events.flatMap((e) => (e.type === 'card' ? [e.card] : []))
  const report = turn.events.find((e): e is Extract<ChatEvent, { type: 'report' }> => e.type === 'report')
  const error = turn.events.find((e): e is Extract<ChatEvent, { type: 'error' }> => e.type === 'error')
  const stopped = turn.events.some((e) => e.type === 'stopped')
  const hasBody = steps.length > 0 || cards.length > 0 || report || error || stopped || turn.running
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
              {turn.running && (
                <li className="flex items-center gap-3">
                  <span className="animate-pulse">{turn.proactive ? 'agents are investigating on their own…' : 'working…'}</span>
                  <Button type="button" variant="outline" size="sm" className="h-6 px-2 font-sans text-xs" onClick={onStop} data-testid="chat-stop">
                    Stop
                  </Button>
                </li>
              )}
              {stopped && <li data-testid="chat-stopped">stopped — what was found until then is above</li>}
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
            {report && (
              <div className="flex justify-end">
                <CopyPrompt build={() => reportPrompt(turn.question, report.text, cards)} />
              </div>
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
