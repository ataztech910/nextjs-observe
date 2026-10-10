// Words for the Checks page: how a scheduled check is doing and what it expects. Pure, so it is tested without a browser.

export interface CheckRun {
  atMs: number
  ok: boolean
  durationMs: number
  status?: number
  traceId: string
  reason?: string
}

export interface CheckFacts {
  name: string
  method: string
  url: string
  everySeconds: number
  expect: { status?: number[]; maxMs?: number; bodyIncludes?: string }
  failures: number
  last?: CheckRun
  history: CheckRun[]
}

/** The same thresholds as the observer's own rule (checks/watch.ts): what is red here is what the AI agents were sent to. */
const IN_ROW = 2
const SHARE_WINDOW = 10
const SHARE_FAILURES = 3

export type CheckState = 'failing' | 'unreliable' | 'passing' | 'waiting'

export function checkState(c: Pick<CheckFacts, 'failures' | 'history' | 'last'>): CheckState {
  if (!c.last) return 'waiting'
  if (c.failures >= IN_ROW) return 'failing'
  const failed = c.history.slice(-SHARE_WINDOW).filter((r) => !r.ok).length
  // Unreliable only while it is still happening: three old failures followed by a clean run of ten would have left the window.
  return failed >= SHARE_FAILURES ? 'unreliable' : 'passing'
}

const ORDER: CheckState[] = ['failing', 'unreliable', 'passing', 'waiting']

/** Worst first; the file's own order within a state. */
export function sortChecks<T extends Pick<CheckFacts, 'failures' | 'history' | 'last'>>(checks: T[]): T[] {
  // sort() is stable: equal states keep the order they came in.
  return checks.map((check) => ({ check, rank: ORDER.indexOf(checkState(check)) })).sort((a, b) => a.rank - b.rank).map((x) => x.check)
}

/** "status 200 or 204 · within 300 ms · contains "Porto Shop"" — what a good answer is. */
export function expectWords(expect: CheckFacts['expect']): string {
  const parts = [expect.status ? `status ${expect.status.join(' or ')}` : 'any 2xx']
  if (expect.maxMs !== undefined) parts.push(`within ${expect.maxMs} ms`)
  if (expect.bodyIncludes !== undefined) parts.push(`contains ${JSON.stringify(expect.bodyIncludes)}`)
  return parts.join(' · ')
}

export function everyWords(seconds: number): string {
  if (seconds < 60) return `every ${seconds} s`
  if (seconds < 3600) return `every ${+(seconds / 60).toFixed(1)} min`
  return `every ${+(seconds / 3600).toFixed(1)} h`
}

/** "12 of 15 runs passed" over what is kept. */
export function passedWords(history: CheckRun[]): string {
  const passed = history.filter((r) => r.ok).length
  return `${passed} of ${history.length} ${history.length === 1 ? 'run' : 'runs'} passed`
}

/** The run whose trace is worth opening: the latest failure that got an answer, else the latest answer. */
export function traceWorthOpening(history: CheckRun[]): CheckRun | undefined {
  const answered = history.filter((r) => r.status !== undefined)
  return answered.findLast((r) => !r.ok) ?? answered.at(-1)
}

/** The question the Investigate button sends to the AI agents. */
export function checkQuestion(c: CheckFacts): string {
  const failed = c.history.findLast((r) => !r.ok)
  if (!failed) return `The scheduled check "${c.name}" (${c.method} ${c.url}) is passing. Is there anything in its recent traces worth worrying about?`
  const how = c.failures >= IN_ROW ? `has failed ${c.failures} times in a row` : `failed ${c.history.filter((r) => !r.ok).length} of its last ${c.history.length} runs`
  const where = failed.status === undefined ? 'No answer came back, so there is no trace of that request — is the service receiving any traffic at all?' : `The app recorded the last failing request as trace ${failed.traceId}: open it, name the span that failed or took the time and its code file.`
  return `The scheduled check "${c.name}" (${c.method} ${c.url}) ${how}. Last failure: ${failed.reason ?? 'failed'}. ${where}`
}
