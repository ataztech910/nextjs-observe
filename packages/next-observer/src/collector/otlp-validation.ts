import type { OtlpSpan, OtlpTraceRequest } from './otlp-types.js'

import { boundOtlp, id, integer, invalid, list, object, resource, str, uint32 } from './otlp-validation-common.js'
export { OtlpValidationError } from './otlp-validation-common.js'
export interface TraceDecodeLimits {
  /** Default 10,000. Invalid requests are rejected atomically, not silently truncated. */
  maxSpans?: number
  /** Applies to all JSON containers, including nested attributes. Default 32. */
  maxDepth?: number
  /** Default 250,000 JSON values per request. */
  maxValues?: number
}
function span(v: unknown, p: string): OtlpSpan {
  const s = object(v, p)
  const start = integer(s.startTimeUnixNano, `${p}.startTimeUnixNano`)
  const end = integer(s.endTimeUnixNano, `${p}.endTimeUnixNano`)
  if (BigInt(end) < BigInt(start)) return invalid(p, 'end precedes start')
  const traceId = id(s.traceId, 32, `${p}.traceId`)
  const spanId = id(s.spanId, 16, `${p}.spanId`)
  const parentSpanId = id(s.parentSpanId, 16, `${p}.parentSpanId`, true)
  if (parentSpanId === spanId) return invalid(p, 'span cannot parent itself')
  const name = str(s.name, `${p}.name`)
  if (!name) return invalid(p, 'span name is required')
  const status = s.status === undefined ? {} : object(s.status, `${p}.status`)
  return {
    ...resource(s, p), traceId, spanId, parentSpanId, name,
    traceState: str(s.traceState, p), flags: uint32(s.flags, p), kind: uint32(s.kind, p),
    startTimeUnixNano: start, endTimeUnixNano: end,
    droppedEventsCount: uint32(s.droppedEventsCount, p), droppedLinksCount: uint32(s.droppedLinksCount, p),
    status: { code: uint32(status.code, p), message: str(status.message, p) },
    events: list(s.events, `${p}.events`).map((x, i) => {
      const e = object(x, `${p}.events[${i}]`)
      return { ...resource(e, p), name: str(e.name, p), timeUnixNano: integer(e.timeUnixNano, `${p}.events[${i}].timeUnixNano`) }
    }),
    links: list(s.links, `${p}.links`).map((x, i) => {
      const l = object(x, `${p}.links[${i}]`)
      return { ...resource(l, p), traceId: id(l.traceId, 32, `${p}.links[${i}].traceId`), spanId: id(l.spanId, 16, `${p}.links[${i}].spanId`), traceState: str(l.traceState, p), flags: uint32(l.flags, p) }
    }),
  }
}

/** Returns a detached, canonical supported-field envelope. Full-request validation precedes storage. */
export function validateOtlpTraceRequest(input: unknown, limits: TraceDecodeLimits = {}): OtlpTraceRequest {
  boundOtlp(input, limits)
  const request = object(input, 'request')
  let count = 0
  const maxSpans = limits.maxSpans ?? 10_000
  return { resourceSpans: list(request.resourceSpans, 'resourceSpans').map((r, ri) => {
    const rs = object(r, `resourceSpans[${ri}]`)
    return {
      resource: resource(rs.resource, 'resource'), schemaUrl: str(rs.schemaUrl, 'resource.schemaUrl'),
      scopeSpans: list(rs.scopeSpans, 'scopeSpans').map((x) => {
        const ss = object(x, 'scopeSpans[]')
        const scope = ss.scope === undefined ? {} : object(ss.scope, 'scope')
        return {
          scope: { ...resource(scope, 'scope'), name: str(scope.name, 'scope.name'), version: str(scope.version, 'scope.version') },
          schemaUrl: str(ss.schemaUrl, 'scope.schemaUrl'),
          spans: list(ss.spans, 'spans').map((s) => {
            if (++count > maxSpans) return invalid('request', 'maximum span count exceeded')
            return span(s, `spans[${count - 1}]`)
          }),
        }
      }),
    }
  }) }
}
