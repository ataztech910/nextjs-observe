/** google.rpc.Status encoding for OTLP/HTTP failures (success remains ExportTraceServiceResponse). */
export function otlpErrorStatus(httpStatus: number, message: string): { code: number; message: string } {
  const codes: Record<number, number> = { 400: 3, 401: 16, 403: 7, 413: 8, 415: 12, 429: 8, 503: 14 }
  return { code: codes[httpStatus] ?? 13, message }
}

export function encodeOtlpError(status: { code: number; message: string }): Buffer {
  const message = Buffer.from(status.message, 'utf8')
  const length: number[] = []
  let n = message.length
  do { length.push((n & 0x7f) | (n > 127 ? 0x80 : 0)); n = Math.floor(n / 128) } while (n)
  return Buffer.concat([Buffer.from([8, status.code, 18, ...length]), message])
}
