// The question about a failing check — one wording for the anomaly the observer raises and for the Investigate button.
// No Node code here: the UI imports it too.

/** "http://localhost:3000" of a check's address — what is down when nothing there accepts a connection. */
export function originOf(url: string): string {
  // try/catch, not URL.canParse: this runs in the browser too, and older ones do not have it.
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export interface CheckFailure {
  name: string
  method: string
  url: string
  /** 'in_row': `count` failures in a row; 'share': `count` of the last `runs`. */
  rule: 'in_row' | 'share'
  count: number
  runs: number
  reason: string
  /** A status came back: the app handled the request and has its trace. */
  answered: boolean
  /** No connection was made: there cannot be a trace. Neither flag: nobody knows whether the request arrived. */
  unreachable?: boolean
  traceId: string
  /** Other checks that get no connection to the same address (`origin`) either: the app is down, not one route. */
  alsoUnreachable?: string[]
  origin?: string
}

/** Where to look after a failed run: its trace, when there can be one. */
export function whereToLook(f: Pick<CheckFailure, 'answered' | 'unreachable' | 'traceId'>): string {
  // A request that reached nobody left no trace: sending the agents after one would have them report "trace not found".
  if (f.unreachable) return 'The request reached nobody, so there is no trace of it — check whether the service is receiving any traffic at all.'
  if (f.answered) return `The app recorded the last failing request as trace ${f.traceId}: open it, name the span that failed or took the time and its code file.`
  return `No answer came back. If the request arrived, it is trace ${f.traceId}: try to open it and name the span where it got stuck. If there is no such trace, the request never arrived or the app is stuck — check whether the service is receiving any traffic at all.`
}

export function checkFailureQuestion(f: CheckFailure): string {
  const how = f.rule === 'in_row' ? `failed ${f.count} ${f.count === 1 ? 'time' : 'times'} in a row` : `failed ${f.count} of its last ${f.runs} runs`
  const question = `the scheduled check "${f.name}" (${f.method} ${f.url}) ${how}. Last failure: ${f.reason}. ${whereToLook(f)}`
  const also = f.alsoUnreachable ?? []
  if (also.length === 0) return question
  const others = also.length === 1 ? `Another check gets no connection either (${also[0]})` : `${also.length} other checks get no connection either (${also.join(', ')})`
  return `${question} ${others}: ${f.origin ?? 'the app'} looks down as a whole, not one route.`
}
