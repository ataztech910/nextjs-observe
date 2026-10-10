// The question about a failing check — one wording for the anomaly the observer raises and for the Investigate button.
// No Node code here: the UI imports it too.

export interface CheckFailure {
  name: string
  method: string
  url: string
  /** 'in_row': `count` failures in a row; 'share': `count` of the last `runs`. */
  rule: 'in_row' | 'share'
  count: number
  runs: number
  reason: string
  unreachable?: boolean
  traceId: string
}

export function checkFailureQuestion(f: CheckFailure): string {
  const how = f.rule === 'in_row' ? `failed ${f.count} ${f.count === 1 ? 'time' : 'times'} in a row` : `failed ${f.count} of its last ${f.runs} runs`
  // A request that reached nobody left no trace: sending the agents after one would have them report "trace not found".
  const where = f.unreachable
    ? 'The request reached nobody, so there is no trace of it — check whether the service is receiving any traffic at all.'
    : `The app recorded the last failing request as trace ${f.traceId}: open it, name the span that failed or took the time and its code file.`
  return `the scheduled check "${f.name}" (${f.method} ${f.url}) ${how}. Last failure: ${f.reason}. ${where}`
}
