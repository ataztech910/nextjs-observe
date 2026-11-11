/** Supported OTLP trace fields. Integers/times are canonical decimal strings after validation. */
export interface OtlpAnyValue {
  stringValue?: string
  boolValue?: boolean
  intValue?: string | number
  doubleValue?: number | 'NaN' | 'Infinity' | '-Infinity'
  bytesValue?: string
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}
export interface OtlpKeyValue { key: string; value?: OtlpAnyValue }
export interface OtlpResource { attributes?: OtlpKeyValue[]; droppedAttributesCount?: number }
export interface OtlpScope extends OtlpResource { name?: string; version?: string }
export interface OtlpLink extends OtlpResource {
  traceId: string
  spanId: string
  traceState?: string
  flags?: number
}
export interface OtlpEvent extends OtlpResource { name: string; timeUnixNano: string | number }
export interface OtlpSpan extends OtlpResource {
  traceId: string
  spanId: string
  parentSpanId?: string
  traceState?: string
  flags?: number
  name: string
  kind?: number
  startTimeUnixNano: string | number
  endTimeUnixNano: string | number
  events?: OtlpEvent[]
  links?: OtlpLink[]
  droppedEventsCount?: number
  droppedLinksCount?: number
  status?: { code?: number; message?: string }
}
export interface OtlpTraceRequest {
  resourceSpans?: {
    resource?: OtlpResource
    schemaUrl?: string
    scopeSpans?: { scope?: OtlpScope; schemaUrl?: string; spans?: OtlpSpan[] }[]
  }[]
}
/** Typed source data alongside the legacy display projection; not an archive of unknown wire fields. */
export interface OtlpSpanData {
  schemaVersion: 1
  resource: OtlpResource
  resourceSchemaUrl: string
  scope: OtlpScope
  scopeSchemaUrl: string
  span: OtlpSpan
}
