// Words for the Checks page: how a scheduled check is doing and what it expects. Pure, so it is tested without a browser.
import { CHECK_RULE, type CheckResult, type CheckRule, type CheckStatus } from '../../../src/checks/types.js'
import { checkFailureQuestion } from '../../../src/checks/words.js'

export type CheckState = 'failing' | 'unreliable' | 'passing' | 'waiting'

type Facts = Pick<CheckStatus, 'failures' | 'history' | 'last'>

/** The runs the rule looks at. */
const recent = (history: CheckResult[], rule: CheckRule) => history.slice(-rule.shareWindow)

/** The observer's own rule (see CheckRule): what is red or amber here is what the AI agents were sent to. */
export function checkState(c: Facts, rule: CheckRule = CHECK_RULE): CheckState {
  if (!c.last) return 'waiting'
  if (c.failures >= rule.failuresInRow) return 'failing'
  // Unreliable only while it is still happening: old failures leave the window.
  return recent(c.history, rule).filter((r) => !r.ok).length >= rule.shareFailures ? 'unreliable' : 'passing'
}

const ORDER: CheckState[] = ['failing', 'unreliable', 'passing', 'waiting']

/** Worst first; the file's own order within a state. */
export function sortChecks<T extends Facts>(checks: T[], rule: CheckRule = CHECK_RULE): T[] {
  // sort() is stable: equal states keep the order they came in.
  return checks.map((check) => ({ check, rank: ORDER.indexOf(checkState(check, rule)) })).sort((a, b) => a.rank - b.rank).map((x) => x.check)
}

/** The line above the cards: how many are in which state, and what the observer does about it. */
export function summaryWords(checks: Facts[], rule: CheckRule = CHECK_RULE, investigates = true): string {
  const count = (state: CheckState) => checks.filter((c) => checkState(c, rule) === state).length
  const failing = count('failing')
  const unreliable = count('unreliable')
  const waiting = count('waiting')
  // A check whose latest run failed, once: not an incident yet, but not something to call "all passing" either.
  const failedOnce = checks.filter((c) => checkState(c, rule) === 'passing' && c.last && !c.last.ok).length
  const parts = [failing && `${failing} failing`, unreliable && `${unreliable} unreliable`, failedOnce && `${failedOnce} failed its last run`, waiting && `${waiting} waiting for ${waiting === 1 ? 'its' : 'their'} first run`].filter(Boolean)
  if (parts.length === 0) return 'All passing.'
  const words = `${parts.join(' · ')} — of ${checks.length}.`
  if (failing + unreliable === 0) return words
  const when = `a check that fails ${rule.failuresInRow} ${rule.failuresInRow === 1 ? 'time' : 'times'} in a row, or ${rule.shareFailures} of its last ${rule.shareWindow} runs`
  return investigates ? `${words} The AI agents look into ${when}.` : `${words} Nobody is sent to look: the AI agents investigate on their own only with the detector and the chat on.`
}

/** "status 200 or 204 · within 300 ms · contains "Porto Shop"" — what a good answer is. */
export function expectWords(expect: CheckStatus['expect']): string {
  const parts = [expect.status ? `status ${expect.status.join(' or ')}` : 'any 2xx']
  if (expect.maxMs !== undefined) parts.push(`within ${expect.maxMs} ms`)
  if (expect.bodyIncludes !== undefined) parts.push(`contains ${JSON.stringify(expect.bodyIncludes)}`)
  return parts.join(' · ')
}

/** One decimal, and the unit chosen after rounding: 3599 s is "1 h", not "60 min". */
function inUnits(seconds: number): string {
  const tenth = (n: number) => Math.round(n * 10) / 10
  if (tenth(seconds) < 60) return `${tenth(seconds)} s`
  if (tenth(seconds / 60) < 60) return `${tenth(seconds / 60)} min`
  if (tenth(seconds / 3600) < 24) return `${tenth(seconds / 3600)} h`
  return `${tenth(seconds / 86_400)} d`
}

export function everyWords(seconds: number): string {
  return `every ${inUnits(seconds)}`
}

/** How long ago, never rounded up: 90 s is "1 min ago". */
export function agoWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

/** "12 of 15 runs passed" over what is kept. */
export function passedWords(history: CheckResult[]): string {
  const passed = history.filter((r) => r.ok).length
  return `${passed} of ${history.length} ${history.length === 1 ? 'run' : 'runs'} passed`
}

/** The latest failure the rule still looks at — the one the card, its trace link and the question all talk about. */
function latestFailure(c: Pick<CheckStatus, 'history'>, rule: CheckRule): CheckResult | undefined {
  return recent(c.history, rule).findLast((r) => !r.ok)
}

/**
 * The run whose trace the card links to: the latest recent failure, else the latest run. Nothing when that request
 * reached nobody — an older failure's trace would explain some other problem.
 */
export function traceWorthOpening(c: Pick<CheckStatus, 'history'>, rule: CheckRule = CHECK_RULE): CheckResult | undefined {
  const failed = latestFailure(c, rule)
  if (failed && !failed.unreachable) return failed
  // No failure with a trace: the latest run — unless that is the one that reached nobody.
  const latest = c.history.at(-1)
  return latest && !latest.unreachable ? latest : undefined
}

/** When the answer (or the failure) came in — a run that timed out after 10 s did not "happen 10 s ago" the moment it shows up. */
export function finishedAtMs(run: CheckResult): number {
  return run.atMs + Math.max(0, run.durationMs)
}

/** The question the Investigate button sends to the AI agents — the same wording as the anomaly the observer raises. */
export function checkQuestion(c: CheckStatus, rule: CheckRule = CHECK_RULE): string {
  const failed = latestFailure(c, rule)
  const runs = recent(c.history, rule)
  const passing = `The scheduled check "${c.name}" (${c.method} ${c.url}) is passing`
  if (!failed) return `${passing}. Is there anything in its recent traces worth worrying about?`
  // Green and answering again: an old blip is a footnote, not "the service gets no traffic".
  if (checkState(c, rule) === 'passing' && c.last?.ok) {
    return `${passing} now, but failed ${runs.filter((r) => !r.ok).length} of its last ${runs.length} runs (last: ${failed.reason ?? 'failed'}). Is that worth worrying about?`
  }
  const inRow = c.failures >= rule.failuresInRow
  const question = checkFailureQuestion({
    name: c.name,
    method: c.method,
    url: c.url,
    rule: inRow ? 'in_row' : 'share',
    count: inRow ? c.failures : runs.filter((r) => !r.ok).length,
    runs: runs.length,
    reason: failed.reason ?? 'failed',
    answered: failed.status !== undefined,
    unreachable: failed.unreachable,
    traceId: failed.traceId,
  })
  return question.charAt(0).toUpperCase() + question.slice(1)
}
