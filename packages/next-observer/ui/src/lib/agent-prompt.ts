// Prompts for a coding agent (Claude Code, Cursor, …): what next-observer measured, written so the agent can go
// straight to the code. Only measured facts go in — the agent is told to treat them as given and not to invent more.
import { isFrameworkSpan } from '../../../src/collector/framework.js'
import type { EvidenceCard } from '../../../src/collector/chat.js'
import type { Defect } from '../../../src/collector/defects.js'
import type { NormalizedSpan } from '../../../src/collector/types.js'
import { affectedBy, requestWords } from './defects.js'
import { rootSpan, timeByOperation } from './trace-analysis.js'
import { formatDuration } from './waterfall.js'

const INTRO =
  'You are working in the codebase of a Next.js app. The facts below were measured by next-observer from OpenTelemetry traces of the running app. Treat them as given; do not assume anything about runtime behaviour that is not listed.'

const OUTRO = 'If the code does not explain the numbers, say so instead of guessing.'

const TOP_OPERATIONS = 6
const STACK_LINES = 8
const pct = (n: number) => `${Math.round(n * 100)}%`
const NO_MESSAGE = '(no message)'

function exception(span: NormalizedSpan): { message: string; type?: string; stack?: string } | undefined {
  if (span.status !== 'error') return undefined
  const attrs = span.events.find((e) => e.name === 'exception')?.attributes
  const text = (key: string) => (typeof attrs?.[key] === 'string' && attrs[key] ? (attrs[key] as string) : undefined)
  const message = text('exception.message') ?? span.statusMessage ?? undefined
  if (!message) return undefined
  // The top of the stack names the file and line; the rest is framework frames.
  const stack = text('exception.stacktrace')?.split('\n').slice(0, STACK_LINES).join('\n')
  return { message, type: text('exception.type'), stack }
}

const fileOf = (span: NormalizedSpan) => (typeof span.attributes['code.filepath'] === 'string' ? (span.attributes['code.filepath'] as string) : undefined)

export interface TracePromptInput {
  traceId: string
  spans: (NormalizedSpan & { coldStart?: boolean })[]
  /** How this operation usually behaves, when known. */
  usual?: { p50Ms: number; p95Ms: number; calls: number }
}

export function tracePrompt({ traceId, spans, usual }: TracePromptInput): string {
  const root = rootSpan(spans)
  if (!root) return ''
  // The app's own code is what the agent can change; Next's internal steps are listed only if nothing else is there.
  const own = spans.filter((s) => !isFrameworkSpan(s))
  const shown = own.length > 0 ? own : spans
  const shownIds = new Set(shown.map((s) => s.spanId))
  const rows = timeByOperation(spans)
    .filter((r) => spans.some((s) => shownIds.has(s.spanId) && s.name === r.name && s.service === r.service))
    .slice(0, TOP_OPERATIONS)
  const file = (name: string, service: string) => shown.map((s) => (s.name === name && s.service === service ? fileOf(s) : undefined)).find(Boolean)
  const errors = shown.flatMap((s) => {
    const e = exception(s)
    // A failed function marks its callers failed too: keep the spans that carry the actual exception.
    return e && s.events.some((ev) => ev.name === 'exception') ? [{ span: s, ...e }] : []
  })
  const failed = root.status === 'error' || errors.length > 0

  // The same operation called 3+ times under one parent: the N+1 pattern.
  const repeated: string[] = []
  const byParent = new Map<string, NormalizedSpan[]>()
  for (const s of shown) {
    if (!s.parentSpanId) continue
    const key = `${s.parentSpanId}\u0000${s.name}`
    const group = byParent.get(key)
    if (group) group.push(s)
    else byParent.set(key, [s])
  }
  for (const group of byParent.values()) {
    if (group.length < 3) continue
    const parent = spans.find((s) => s.spanId === group[0].parentSpanId)
    repeated.push(`- \`${group[0].name}\` is called ${group.length} times by \`${parent?.name ?? 'its parent'}\` (${formatDuration(group.reduce((sum, s) => sum + s.durationMs, 0))} in total)`)
  }

  const version = root.serviceVersion ? `${root.service}@${root.serviceVersion}` : root.service
  const lines = [
    INTRO,
    '',
    '## Problem',
    `\`${root.name}\` ${failed ? 'failed' : 'took'} ${failed ? `after ${formatDuration(root.durationMs)}` : formatDuration(root.durationMs)} (${version}, trace \`${traceId}\`).`,
  ]
  if (usual) lines.push(`Usually: median ${formatDuration(usual.p50Ms)}, p95 ${formatDuration(usual.p95Ms)} over ${usual.calls} calls.`)
  if (root.coldStart) lines.push('This was the first request of the route after a server start: in `next dev` its time includes compiling the route.')

  if (errors.length > 0) {
    lines.push('', '## Errors')
    for (const e of errors) {
      const where = fileOf(e.span)
      lines.push(`- \`${e.span.name}\`${where ? ` (\`${where}\`)` : ''}: ${e.type ? `${e.type}: ` : ''}${e.message}`)
      if (e.stack) lines.push('  ```', ...e.stack.split('\n').map((l) => `  ${l}`), '  ```')
    }
  }

  lines.push('', '## Where the time went', 'Own time of each operation (without the calls it makes), share of all own time in the trace:')
  for (const r of rows) {
    const where = file(r.name, r.service)
    lines.push(`- \`${r.name}\`: ${formatDuration(r.selfMs)} (${pct(r.selfShare)})${r.calls > 1 ? `, ${r.calls} calls` : ''}${where ? `, \`${where}\`` : ''}`)
  }
  if (repeated.length > 0) lines.push('', '## Repeated calls', ...repeated)

  lines.push(
    '',
    '## Task',
    failed ? '1. Open the code named above and find why it throws.' : '1. Open the code named above and find what makes it slow.',
    '2. Explain the cause in a few sentences, pointing at the lines.',
    '3. Propose the smallest change that fixes it. Do not change behaviour elsewhere.',
    OUTRO,
  )
  return lines.join('\n')
}

export function defectPrompt(d: Defect): string {
  const lines = [
    INTRO,
    '',
    '## Problem',
    d.category === 'browser-error'
      ? `In the browser (service ${d.service}), ${d.pages.length ? `on ${d.pages.map((p) => `\`${p.path}\``).join(', ')}, ` : ''}this was recorded as "${d.operation}":`
      : d.category === 'request'
        ? `${requestWords(d.source)} \`${d.operation}\` (service ${d.service}) fails with:`
        : `\`${d.operation}\` (service ${d.service}) fails with:`,
    '```',
    `${d.type ? `${d.type}: ` : ''}${d.message}`,
    '```',
    `${d.count} ${d.count === 1 ? 'occurrence' : 'occurrences'} in the selected window.`,
  ]
  const affected = affectedBy(d)
  if (affected.length > 0) lines.push(`Requests failing because of it: ${affected.map((a) => `\`${a.operation}\` (${a.count})`).join(', ')}.`)
  if (d.isNew) lines.push(`It first appeared in version ${d.firstSeenVersion}; it was not seen in earlier versions.`)
  else if (d.versions.length > 0) lines.push(`Seen in ${d.versions.length === 1 ? 'version' : 'versions'} ${d.versions.join(', ')}; first seen in ${d.firstSeenVersion ?? 'an unknown version'}.`)
  if (d.exampleTraceIds.length > 0) lines.push(`Example traces: ${d.exampleTraceIds.map((id) => `\`${id}\``).join(', ')}.`)
  lines.push(
    '',
    '## Task',
    d.category === 'browser-error'
      ? '1. Find the client code on that page that can produce this error (the message and the component named in it are the leads).'
      : d.category === 'request'
        ? `1. Find where the app makes this request and the route that should answer it; say which side is wrong (the URL, the route, or what the route does).`
        : `1. Find where \`${d.operation}\` is implemented and which line can throw this.`,
    d.isNew ? `2. Look at what changed in ${d.firstSeenVersion} around it (git log / diff) and explain the cause.` : '2. Explain under which inputs or conditions it throws.',
    '3. Propose the smallest change that fixes it, and say how to verify the fix.',
    OUTRO,
  )
  return lines.join('\n')
}

function cardFact(card: EvidenceCard): string | undefined {
  switch (card.kind) {
    case 'regression':
      return `\`${card.operation}\` (${card.service}): p95 ${formatDuration(card.from.p95Ms)} in ${card.from.version} → ${formatDuration(card.to.p95Ms)} in ${card.to.version}${card.p95Ratio !== null ? ` (×${card.p95Ratio})` : ''}; error rate ${pct(card.from.errorRate)} → ${pct(card.to.errorRate)}.`
    case 'errors':
      // The route that failed because a function inside it threw has no message of its own — the function's card says it all.
      if (card.message === NO_MESSAGE) return undefined
      return `\`${card.operation}\` (${card.service}) fails in ${card.errorRate === null ? 'some' : pct(card.errorRate)} of calls: "${card.message}". Example traces: ${card.traceIds.map((id) => `\`${id}\``).join(', ')}.`
    case 'n-plus-one':
      return `\`${card.parent}\` calls \`${card.operation}\` ${card.count} times in one request (${formatDuration(card.totalMs)} in total, trace \`${card.traceId}\`).`
    case 'hotspot':
      return `\`${card.operation}\` spends ${formatDuration(card.selfMs)} of a ${formatDuration(card.traceMs)} request in its own code${card.codeFile ? ` — \`${card.codeFile}\`` : ''} (trace \`${card.traceId}\`).`
    case 'silent':
      return `No spans from ${card.service} for ${card.lastSpanSecondsAgo} s.`
    case 'traces':
      return undefined
  }
}

/** From a finished investigation: the measured evidence (built by code, not by the model) first, the agents' reading second. */
export function reportPrompt(question: string, report: string, cards: EvidenceCard[]): string {
  const facts = cards.map(cardFact).filter((f): f is string => f !== undefined)
  const lines = [INTRO, '', '## Problem', question]
  if (facts.length > 0) lines.push('', '## Measured', ...[...new Set(facts)].map((f) => `- ${f}`))
  lines.push(
    '',
    '## Diagnosis by the observability agents',
    'Written by a model from the data above — check it against the code rather than trusting it.',
    '',
    report.trim(),
    '',
    '## Task',
    '1. Open the code named above and confirm or correct the diagnosis.',
    '2. Propose the smallest change that fixes the problem. Do not change behaviour elsewhere.',
    OUTRO,
  )
  return lines.join('\n')
}
