import type { NormalizedSpan } from './types.js'

/**
 * Next.js internal steps of a request ("executing api route (app) …", "render route (app) …", "start response"): they
 * carry `next.span_type` but are not the request's server span. They repeat the endpoint's and user code's numbers, so
 * agents' aggregates skip them — otherwise one slow call shows up as three problems. Traces keep them for structure.
 */
export function isFrameworkSpan(span: Pick<NormalizedSpan, 'kind' | 'attributes'>): boolean {
  return span.attributes?.['next.span_type'] !== undefined && span.kind !== 'server'
}
