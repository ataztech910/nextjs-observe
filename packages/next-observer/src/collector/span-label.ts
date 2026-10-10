// What a person reads for a span. OTel names an HTTP client span by its method only ("GET") and puts the address in
// url.full — correct for grouping, useless in a list of traces. The label adds the path; the span name stays as is.
import type { NormalizedSpan } from './types.js'

const METHOD_ONLY = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/

type Labelled = Pick<NormalizedSpan, 'name' | 'kind' | 'attributes'>

/** The method and path of a client request span that is named by its method only; undefined for any other span. */
export function requestParts(span: Labelled): { method: string; pathname: string } | undefined {
  if (span.kind !== 'client' || !METHOD_ONLY.test(span.name)) return undefined
  const url = span.attributes['url.full'] ?? span.attributes['http.url']
  if (typeof url !== 'string') return undefined
  try {
    return { method: span.name, pathname: new URL(url).pathname }
  } catch {
    return undefined
  }
}

export function spanLabel(span: Labelled): string {
  const request = requestParts(span)
  return request ? `${request.method} ${request.pathname}` : span.name
}

// A path segment that names one thing rather than a kind of thing: a number, a UUID, a long hex run.
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,})$/i
// …or a long opaque token (nanoid, a signed id). It must contain a digit: `recently-viewed-products` is 24
// characters of route name, not an id.
const isToken = (segment: string) => segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment)

/**
 * What a span is grouped by. For everything but a browser/HTTP client request that is its name. A client request is
 * named by its method only, so all failing GETs would be one "GET": here it gets its path, with id-like segments
 * replaced — `/api/inventory/1` and `/api/inventory/2` are the same operation, `GET /api/inventory/:id`. (The server
 * span knows the real route pattern; the browser only ever sees the URL.)
 */
export function spanOperation(span: Labelled): string {
  const request = requestParts(span)
  if (!request) return span.name
  const path = request.pathname.split('/').map((segment) => (ID_SEGMENT.test(segment) || isToken(segment) ? ':id' : segment)).join('/')
  return `${request.method} ${path}`
}
