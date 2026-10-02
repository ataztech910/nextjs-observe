// Runtime proxy for browser spans. Opt in with one file in the app:
//   app/api/next-observe/[...path]/route.ts   →   export { POST } from 'next-observe/proxy'
// withObserve() then sends /__observe/* here instead of the build-time rewrite, so the destination and headers are read
// when the server runs (OBSERVE_*, OTEL_EXPORTER_OTLP_*), and secrets such as Authorization stay on the server.
import { resolveServerOptions, type Destination } from './exporter-config.js'

export const MAX_BODY_BYTES = 5 * 1024 * 1024

const json = (status: number, body: unknown) => Response.json(body, { status })

export async function POST(request: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const { path = [] } = await context.params
  // The browser exporter only sends traces; anything else is not ours to forward.
  if (path.join('/') !== 'v1/traces') return json(404, { error: 'not found' })

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'body too large' })
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) return json(413, { error: 'body too large' })

  const [primary, ...others] = resolveServerOptions().destinations
  const type = request.headers.get('content-type') ?? 'application/json'
  // The browser sends OTLP/JSON; each destination gets its own headers (API keys, Authorization) here, never in the browser.
  const send = ({ url, headers }: Destination) => fetch(url, { method: 'POST', headers: { ...headers, 'content-type': type }, body })
  // Every destination gets the spans; the browser sees the first one's answer (the others must not slow it down or fail it).
  for (const destination of others) send(destination).catch(() => {})
  try {
    const upstream = await send(primary)
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    // Losing telemetry must not look like an app error in the browser console beyond this one response.
    return json(502, { error: 'trace backend unreachable' })
  }
}
