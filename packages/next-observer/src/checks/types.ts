// What the runner reports — types only, so the UI can import them without pulling in Node code.
import type { Check } from './spec.js'

export interface CheckResult {
  atMs: number
  ok: boolean
  durationMs: number
  /** Absent when no answer came at all. */
  status?: number
  /** The trace id sent with the request. */
  traceId: string
  /** Why it failed, in words; absent when ok. */
  reason?: string
  /**
   * The request never got to anyone (connection refused, unknown host): the app has no trace of it. A timeout is not
   * this — the request arrived, and its trace shows where the time went.
   */
  unreachable?: true
}

/**
 * When a failing check counts as an incident. One set of numbers for the rule that sends the AI agents (watch.ts)
 * and for the colours on the Checks page.
 */
export interface CheckRule {
  /** Failed runs in a row. */
  failuresInRow: number
  /** How many of the latest runs the share is taken from. */
  shareWindow: number
  /** Failed runs among them. */
  shareFailures: number
}
export const CHECK_RULE: CheckRule = { failuresInRow: 2, shareWindow: 10, shareFailures: 3 }

/** What GET /api/checks answers. */
export interface ChecksReport {
  checks: CheckStatus[]
  /** The observer's clock, so "5 s ago" does not depend on the browser's. */
  nowMs: number
  rule: CheckRule
  /** Whether a check that breaks the rule is handed to the AI agents (a detector and a chat are both on). */
  investigates: boolean
}

export interface CheckStatus {
  name: string
  method: string
  /** Where the request really goes. */
  url: string
  everySeconds: number
  expect: Check['expect']
  /** Failed runs in a row up to now; 0 when the last run passed or nothing ran yet. */
  failures: number
  last?: CheckResult
  /** Oldest first. */
  history: CheckResult[]
}
