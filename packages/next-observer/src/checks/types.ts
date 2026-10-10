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
