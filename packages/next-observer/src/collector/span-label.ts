// What a person reads for a span. OTel names an HTTP client span by its method only ("GET") and puts the address in
// url.full — correct for grouping, useless in a list of traces. The label adds the path; the span name stays as is.
import type { NormalizedSpan } from './types.js'

const METHOD_ONLY = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/

export function spanLabel(span: Pick<NormalizedSpan, 'name' | 'kind' | 'attributes'>): string {
  if (span.kind !== 'client' || !METHOD_ONLY.test(span.name)) return span.name
  const url = span.attributes['url.full'] ?? span.attributes['http.url']
  if (typeof url !== 'string') return span.name
  try {
    return `${span.name} ${new URL(url).pathname}`
  } catch {
    return span.name
  }
}

// A path segment that names one thing rather than a kind of thing: a number, a UUID, a long hex or a long opaque token.
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}|[A-Za-z0-9_-]{20,})$/i

/**
 * What a span is grouped by. For everything but a browser/HTTP client request that is its name. A client request is
 * named by its method only, so all failing GETs would be one "GET": here it gets its path, with id-like segments
 * replaced — `/api/inventory/1` and `/api/inventory/2` are the same operation, `GET /api/inventory/:id`. (The server
 * span knows the real route pattern; the browser only ever sees the URL.)
 */
export function spanOperation(span: Pick<NormalizedSpan, 'name' | 'kind' | 'attributes'>): string {
  const label = spanLabel(span)
  if (label === span.name) return label
  const [method, path] = [label.slice(0, span.name.length), label.slice(span.name.length + 1)]
  return `${method} ${path.split('/').map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment)).join('/')}`
}
