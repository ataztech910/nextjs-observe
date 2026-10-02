// OTLP/HTTP collector + query API. Node built-ins only.
//   POST /v1/traces                 OTLP/JSON ingest (protobuf → 415 until Sprint 2 phase B)
//   GET  /health
//   GET  /api/services
//   GET  /api/traces?service&operation&minDurationMs&hasError&fromMs&toMs&limit
//   GET  /api/traces/:traceId
//   GET  /api/operations?service&operation&fromMs&toMs
//   GET  /api/chat                  { enabled, mode }
//   POST /api/chat                  { question, sessionId? } → NDJSON stream of ChatEvent (status, step…, card…, report | error)
//   GET  /api/chat/events           SSE: proactive turns (detector anomaly → investigation), recent ones replayed on connect
//   GET  /*                         the UI (dist/ui) with SPA fallback
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { questionFor, type AnomalyDetector } from '../debug/detector.js'
import type { ChatEvent, ChatHandler, ProactiveEvent } from './chat.js'
import { decodeOtlpJson, type OtlpTraceRequest } from './decode.js'
import { MemoryStorage } from './memory-storage.js'
import { serveUi } from './static.js'
import type { StorageAdapter } from './types.js'

export interface CollectorOptions {
  /** Default 4318 (standard OTLP/HTTP port). 0 = random free port. */
  port?: number
  host?: string
  storage?: StorageAdapter
  /** When set, ingest requires a matching `x-api-key` header. */
  apiKey?: string
  /** Default 10 MB. */
  maxBodyBytes?: number
  /** Built UI to serve at /. Default: the package's dist/ui. `false` disables it. */
  uiDir?: string | false
  /** Agents answering /api/chat (the CLI always provides them); absent → chat disabled. */
  chat?: { mode: 'mock' | 'real'; handle: ChatHandler }
  /** Watches ingested spans; on an anomaly pushes it to /api/chat/events and, with `chat`, investigates on its own. */
  detector?: Pick<AnomalyDetector, 'observe' | 'check'>
  /** How often the detector window is checked. Default 5 s. */
  detectorIntervalMs?: number
}

const REPLAY_EVENTS = 200

const CHAT_DISABLED = 'chat is disabled: this collector was started without agents'
const MAX_QUESTION = 2000

const DEFAULT_UI_DIR = fileURLToPath(new URL('../ui/', import.meta.url))

export interface Collector {
  url: string
  port: number
  storage: StorageAdapter
  close(): Promise<void>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key',
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    // Past the limit we keep draining without buffering, so the 413 response can still be delivered.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) reject(new HttpError(413, `body exceeds ${limit} bytes`))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (Number.isNaN(n)) throw new HttpError(400, `${name} must be a number`)
  return n
}

function booleanParam(params: URLSearchParams, name: string): boolean | undefined {
  const raw = params.get(name)
  if (raw === null || raw === '') return undefined
  if (raw !== 'true' && raw !== 'false') throw new HttpError(400, `${name} must be true or false`)
  return raw === 'true'
}

const stringParam = (params: URLSearchParams, name: string) => params.get(name) || undefined

export async function startCollector(options: CollectorOptions = {}): Promise<Collector> {
  const storage = options.storage ?? new MemoryStorage()
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024

  async function ingest(req: IncomingMessage, res: ServerResponse) {
    if (options.apiKey && req.headers['x-api-key'] !== options.apiKey) throw new HttpError(401, 'invalid x-api-key')
    const type = req.headers['content-type'] ?? ''
    if (!type.includes('application/json')) {
      throw new HttpError(415, `unsupported content-type "${type}": only OTLP/JSON is accepted, configure the exporter for http/json`)
    }
    let payload: OtlpTraceRequest
    try {
      payload = JSON.parse(await readBody(req, maxBodyBytes))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'body is not valid JSON')
    }
    const spans = decodeOtlpJson(payload)
    await storage.insertSpans(spans)
    options.detector?.observe(spans)
    send(res, 200, {})
  }

  // --- proactive: detector → SSE broadcast → investigation, one at a time ---
  const subscribers = new Set<ServerResponse>()
  const recent: ProactiveEvent[] = []
  let seq = 0
  const broadcast = (message: Omit<ProactiveEvent, 'seq'>) => {
    const envelope: ProactiveEvent = { seq: ++seq, ...message }
    recent.push(envelope)
    if (recent.length > REPLAY_EVENTS) recent.shift()
    const line = `data: ${JSON.stringify(envelope)}\n\n`
    // A queued investigation can outlive close(): never write to an ended response.
    for (const res of subscribers) if (!res.writableEnded) res.write(line)
  }
  let investigations = Promise.resolve()
  const onAnomalies = () => {
    for (const anomaly of options.detector?.check() ?? []) {
      const turnId = anomaly.id
      broadcast({ turnId, event: { type: 'anomaly', anomaly } })
      if (!options.chat) continue
      const chat = options.chat
      // Queued: two investigations at once would double the model load and interleave in the UI.
      investigations = investigations.then(() =>
        chat.handle({ question: questionFor(anomaly) }, (event) => broadcast({ turnId, event })).catch((error: unknown) => {
          broadcast({ turnId, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
        }),
      )
    }
  }

  function events(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    for (const envelope of recent) res.write(`data: ${JSON.stringify(envelope)}\n\n`)
    subscribers.add(res)
    req.on('close', () => subscribers.delete(res))
  }

  async function chat(req: IncomingMessage, res: ServerResponse) {
    if (!options.chat) throw new HttpError(503, CHAT_DISABLED)
    let body: { question?: unknown; sessionId?: unknown }
    try {
      body = JSON.parse(await readBody(req, 64 * 1024))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'body is not valid JSON')
    }
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (!question) throw new HttpError(400, 'question is required')
    if (question.length > MAX_QUESTION) throw new HttpError(400, `question is longer than ${MAX_QUESTION} characters`)
    const sessionId = body.sessionId
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[\w-]{1,100}$/.test(sessionId))) {
      throw new HttpError(400, 'sessionId must be 1–100 characters of letters, digits, _ or -')
    }

    // One JSON event per line, flushed as the agents work — the UI shows each step live.
    res.writeHead(200, { ...CORS, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' })
    const emit = (event: ChatEvent) => {
      if (!res.writableEnded) res.write(JSON.stringify(event) + '\n')
    }
    try {
      await options.chat.handle({ question, ...(sessionId ? { sessionId } : {}) }, emit)
    } catch (error) {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    res.end()
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://collector')
    const q = url.searchParams
    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end()
    if (req.method === 'POST' && url.pathname === '/v1/traces') return ingest(req, res)
    if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res)
    if (req.method !== 'GET') throw new HttpError(404, 'not found')

    if (url.pathname === '/api/chat/events') return events(req, res)
    if (url.pathname === '/api/chat') {
      return send(res, 200, options.chat ? { enabled: true, mode: options.chat.mode } : { enabled: false, reason: CHAT_DISABLED })
    }

    if (url.pathname === '/health') return send(res, 200, { status: 'ok', spans: await storage.count() })
    if (url.pathname === '/api/services') return send(res, 200, await storage.getServices())
    if (url.pathname === '/api/traces') {
      return send(
        res,
        200,
        await storage.queryTraces({
          service: stringParam(q, 'service'),
          operation: stringParam(q, 'operation'),
          minDurationMs: numberParam(q, 'minDurationMs'),
          hasError: booleanParam(q, 'hasError'),
          fromMs: numberParam(q, 'fromMs'),
          toMs: numberParam(q, 'toMs'),
          limit: numberParam(q, 'limit'),
        }),
      )
    }
    const traceMatch = url.pathname.match(/^\/api\/traces\/([0-9a-f]{32})$/)
    if (traceMatch) {
      const spans = await storage.getTrace(traceMatch[1])
      if (spans.length === 0) throw new HttpError(404, 'trace not found')
      return send(res, 200, { traceId: traceMatch[1], spans })
    }
    if (url.pathname === '/api/operations') {
      return send(
        res,
        200,
        await storage.getOperationStats({
          service: stringParam(q, 'service'),
          operation: stringParam(q, 'operation'),
          fromMs: numberParam(q, 'fromMs'),
          toMs: numberParam(q, 'toMs'),
        }),
      )
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) throw new HttpError(404, 'not found')
    const uiDir = options.uiDir ?? DEFAULT_UI_DIR
    if (uiDir && (await serveUi(uiDir, url.pathname, res))) return
    throw new HttpError(404, 'not found')
  }

  const server: Server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) return
      if (error instanceof HttpError) return send(res, error.status, { error: error.message })
      console.error('[nxo collector]', error)
      send(res, 500, { error: 'internal error' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4318, options.host ?? '127.0.0.1', resolve)
  })
  const detectorTimer = options.detector ? setInterval(onAnomalies, options.detectorIntervalMs ?? 5000) : undefined
  // A comment line every 15 s keeps proxies from closing idle SSE connections.
  const heartbeat = setInterval(() => {
    for (const res of subscribers) res.write(': ping\n\n')
  }, 15_000)
  detectorTimer?.unref()
  heartbeat.unref()

  const { port } = server.address() as AddressInfo
  const host = options.host ?? '127.0.0.1'

  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    port,
    storage,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(detectorTimer)
        clearInterval(heartbeat)
        for (const res of subscribers) res.end()
        subscribers.clear()
        server.close((error) => (error ? reject(error) : resolve()))
        // Defensive: don't let any lingering client socket delay shutdown (a hang was seen once in e2e, cause not reproduced).
        server.closeAllConnections()
      }),
  }
}
