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
