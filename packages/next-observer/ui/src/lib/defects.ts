/** The fields of a defect the question is built from (a subset of the API's Defect). */
export interface DefectFacts {
  operation: string
  message: string
  isNew: boolean
  firstSeenVersion: string | null
  versions: string[]
  affected: { operation: string; spanName?: string }[]
  /** Default 'code' — an operation that is a piece of code. */
  category?: 'browser-error' | 'request' | 'code'
  /** Who made the request or hit the error. Default 'server'. */
  source?: 'browser' | 'server'
  pages?: { path: string }[]
}

/** "The browser's request" or, for a call a server made to another service, "The outgoing request". */
export const requestWords = (source: DefectFacts['source']) => (source === 'browser' ? "The browser's request" : 'The outgoing request')

/**
 * The requests that failed because of a defect, without the one that is just the same route seen from the caller: the
 * browser's request to it, which reads the same. Only a request row is dropped (its label differs from its span name).
 * Another service's route of the same name — a BFF passing the call through — is a real request that failed, and stays.
 */
export function affectedBy<T extends { operation: string; spanName?: string }>(d: { operation: string; affected: T[] }): T[] {
  return d.affected.filter((a) => !(a.spanName !== undefined && a.spanName !== a.operation && sameRoute(a.operation, d.operation)))
}

/**
 * What happened, in words that fit the kind of defect: `operation` is a piece of code only for 'code'. For a browser
 * error it is the kind of error ("uncaught error"), for a request the method and path — neither "fails" like a function.
 */
export function describeDefect(d: DefectFacts): string {
  const pages = d.pages?.length ? ` on ${d.pages.map((p) => p.path).join(', ')}` : ''
  if (d.category === 'browser-error') return `In the browser${pages}: ${d.operation} "${d.message}"`
  // The AI agents' tools look spans up by name, and a request's span is named by its method only: say so, or they
  // search for "GET /api/x" and find nothing.
  if (d.category === 'request') return `${requestWords(d.source)} ${d.operation} (a span named "${d.operation.split(' ')[0]}") fails with "${d.message}"`
  const affected = affectedBy(d)
  const where = affected.length ? ` (requests to ${affected[0].operation} fail because of it)` : ''
  return `${d.operation} fails with "${d.message}"${where}`
}

/** What to ask the AI agents about a defect — with the facts the page already knows, so they start from them. */
export function questionFor(d: DefectFacts): string {
  const history = d.isNew && d.firstSeenVersion ? ` It first appeared in ${d.firstSeenVersion}.` : d.versions.length > 1 ? ` It is seen in ${d.versions.join(' and ')}.` : ''
  return `${describeDefect(d)}.${history} Why does it fail, and is it new?`
}

/**
 * The same route as two sides spell it: the server's pattern `GET /api/inventory/[id]` and the browser's request to
 * it, `GET /api/inventory/:id`. "in X · fails X" says nothing, so the card leaves such an affected row out.
 */
export function sameRoute(a: string, b: string): boolean {
  const normalize = (operation: string) => operation.replace(/\[[^\]/]+\]|:id/g, '*')
  return normalize(a) === normalize(b)
}
