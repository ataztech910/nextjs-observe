// OTLP/HTTP collector + query API. Node built-ins only.
//   POST /v1/metrics                OTLP Sum/Gauge/Histogram ingest (JSON/protobuf, optional gzip)
//   GET  /api/performance/metrics     raw retained metric points; per-point histogram quantile bounds
//   POST /v1/traces                 OTLP ingest: application/json or application/x-protobuf, optionally gzip
//   GET  /health
//   GET  /api/services
//   GET  /api/traces?service&operation&exactOperation&minDurationMs&hasError&fromMs&toMs&limit
//   GET  /api/traces/:traceId
//   GET  /api/operations?service&operation&fromMs&toMs
//   GET  /api/overview?windowMs&service&toMs   dashboard: requests by status class, latency, errors, top routes
//   GET  /api/operation?operation&service&windowMs&toMs   one operation: overview, latency histogram, two speeds, versions
//   GET  /api/defects?windowMs&service&toMs   errors grouped by where they originated and their message
//   GET  /api/checks                { checks, nowMs, rule, investigates }: scheduled checks from observe.checks.ts with their latest results
//   GET  /api/regression?service&sinceMinutes   { regression }: the latest version vs the previous one, or null
//   GET  /api/chat                  { enabled, mode, budget }: budget = investigations the observer may still start on its own
//   POST /api/chat                  { question, sessionId? } → NDJSON stream of ChatEvent (status, step…, card…, report | error | stopped); closing the request stops the investigation
//   POST /api/chat/stop             { turnId } → stops an investigation the observer started on its own
//   GET  /api/chat/history          { seq, turns }: every chat turn so far — questions asked and the observer's own investigations
//   GET  /api/chat/events           SSE: proactive turns (detector anomaly → investigation), recent ones replayed on connect
//   GET  /*                         the UI (dist/ui) with SPA fallback
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { questionFor, type Anomaly, type AnomalyDetector } from '../debug/detector.js'
import { createAgentQueries } from '../debug/queries.js'
import { findRegression } from '../debug/regression.js'
import type { ChatEvent, ChatHandler, ProactiveEvent } from './chat.js'
import { ChatHistory } from './chat-history.js'
import { InvestigationBudget, MAX_WAITING } from './budget.js'
import { gunzipSync } from 'node:zlib'
import type { CheckRunner } from '../checks/runner.js'
import { CHECK_RULE, type CheckRule, type ChecksReport } from '../checks/types.js'
import { decodeOtlpJson } from './decode.js'
import type { PerformanceReports } from './performance-reports.js'
import { RunCapture } from './capture.js'
import { CaptureError, RUN_SCHEMA, type RunMetadata } from './run-manifest.js'
import { decodeOtlpMetrics } from './metric-decode.js'
import { protobufToOtlpMetrics } from './metric-protobuf.js'
import { histogramQuantiles } from './metric-query.js'
import { MemoryMetricStorage } from './metric-storage.js'
import type { MetricDecodeLimits, MetricStorageAdapter } from './metric-types.js'
import { encodeOtlpError, otlpErrorStatus } from './otlp-response.js'
import { OtlpValidationError, type TraceDecodeLimits } from './otlp-validation.js'
import { protobufToOtlpJson } from './protobuf.js'
import { computeDefects } from './defects.js'
import { MemoryStorage } from './memory-storage.js'
import { computeOperation } from './operation.js'
import { computeOverview } from './overview.js'
import { serveUi } from './static.js'
import type { NormalizedSpan, StorageAdapter } from './types.js'


const OVERVIEW_DEFAULT_WINDOW_MS = 15 * 60_000
const OVERVIEW_BUCKETS = 30

export interface CollectorOptions {
  /** Default 4318 (standard OTLP/HTTP port). 0 = random free port. */
  port?: number
  host?: string
  storage?: StorageAdapter
  /** When set, ingest requires a matching `x-api-key` header. */
  apiKey?: string
  /**
   * Password for the UI, the query API and the chat (HTTP Basic Auth, any user name) — what people open in a browser.
   * Ingest keeps its x-api-key, /health stays open for uptime checks.
   */
  uiPassword?: string
  /** Default 10 MB. */
  maxBodyBytes?: number
  /** Bounds decoded traces as well as protobuf parsing. */
  traceLimits?: TraceDecodeLimits
  metricLimits?: MetricDecodeLimits
  /** Opt-in local run archives, independent of bounded live stores. */
  capture?: RunCapture
  /** Read-only external analysis reports with verified artifact/run associations. */
  performanceReports?: PerformanceReports
  /** Separate from span storage; false disables metric ingest/query. Default bounded MemoryMetricStorage. */
  metricStorage?: MetricStorageAdapter | false
  /** Built UI to serve at /. Default: the package's dist/ui. `false` disables it. */
  uiDir?: string | false
  /** Agents answering /api/chat (the CLI always provides them); absent → chat disabled. */
  chat?: { mode: 'mock' | 'real'; handle: ChatHandler }
  /** Watches ingested spans; on an anomaly pushes it to /api/chat/events and, with `chat`, investigates on its own. */
  detector?: Pick<AnomalyDetector, 'observe' | 'check'>
  /** How often the detector window is checked. Default 5 s. */
  detectorIntervalMs?: number
  /** How many investigations the observer starts on its own per period. Default 5 per 60 min. */
  budget?: InvestigationBudget
  /** Scheduled checks (observe.checks.ts) whose results /api/checks reports; absent → none configured. */
  checks?: Pick<CheckRunner, 'list'> & Partial<Pick<CheckRunner, 'isCheckTrace'>> & { /** Checks that keep failing, as anomalies; taken on the detector's timer. */ anomalies?: () => Anomaly[]; /** The thresholds behind `anomalies`, for the Checks page. */ rule?: CheckRule }
}

const REPLAY_EVENTS = 200

const CHAT_DISABLED = 'chat is disabled: this collector was started without agents'
const MAX_QUESTION = 2000

const DEFAULT_UI_DIR = fileURLToPath(new URL('../ui/', import.meta.url))

export interface Collector {
  url: string
  port: number
  storage: StorageAdapter
  metricStorage?: MetricStorageAdapter
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

// Constant-time comparison of the given password with the configured one (hashing first makes the lengths equal).
function passwordMatches(header: string | undefined, password: string): boolean {
  const match = /^Basic\s+(.+)$/i.exec(header ?? '')
  if (!match) return false
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const given = decoded.slice(decoded.indexOf(':') + 1)
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return decoded.includes(':') && timingSafeEqual(digest(given), digest(password))
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, content-encoding, x-api-key, x-observe-run-id',
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
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
      else resolve(Buffer.concat(chunks))
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
  const metricStorage = options.metricStorage === false ? undefined : options.metricStorage ?? new MemoryMetricStorage()
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024

  async function ingest(req: IncomingMessage, res: ServerResponse, signal: 'traces' | 'metrics') {
    if (options.apiKey && req.headers['x-api-key'] !== options.apiKey) throw new HttpError(401, 'invalid x-api-key')
    if (signal === 'metrics' && !metricStorage) throw new HttpError(503, 'metric ingestion is disabled')
    const type = req.headers['content-type'] ?? ''
    const protobuf = /^application\/(x-)?protobuf(?:;|$)/i.test(type)
    if (!protobuf && !/^application\/json(?:;|$)/i.test(type)) {
      throw new HttpError(415, `unsupported content-type "${type}": send OTLP as application/json or application/x-protobuf`)
    }
    const encoding = (req.headers['content-encoding'] ?? 'identity').toLowerCase()
    if (encoding !== 'identity' && encoding !== 'gzip') throw new HttpError(415, `unsupported content-encoding "${encoding}": use gzip or none`)
    let body = await readBody(req, maxBodyBytes)
    if (encoding === 'gzip') {
      try {
        // The limit applies after decompression too — a small gzip body must not expand into gigabytes.
        body = gunzipSync(body, { maxOutputLength: maxBodyBytes })
      } catch (error) {
        const tooLarge = (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
        throw new HttpError(tooLarge ? 413 : 400, tooLarge ? `body exceeds ${maxBodyBytes} bytes after gzip` : 'body is not valid gzip')
      }
    }
    let payload: unknown
    const limits = signal === 'traces' ? options.traceLimits : options.metricLimits
    try {
      payload = protobuf
        ? signal === 'traces' ? protobufToOtlpJson(body, limits) : protobufToOtlpMetrics(body, limits)
        : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    } catch {
      throw new HttpError(400, protobuf ? `body is not a valid OTLP protobuf Export${signal === 'traces' ? 'Trace' : 'Metrics'}ServiceRequest` : 'body is not valid JSON')
    }
    const run = req.headers['x-observe-run-id']
    if (run !== undefined) {
      if (!options.capture) throw new HttpError(503, 'run capture is disabled')
      if (typeof run !== 'string') throw new HttpError(400, 'invalid x-observe-run-id')
      // Apply configured protocol limits before the archive's independent replay validation.
      if (signal === 'metrics') decodeOtlpMetrics(payload, options.metricLimits)
      else decodeOtlpJson(payload, options.traceLimits)
      // Tagged requests belong exclusively to this run, never to another run or the live detector.
      await options.capture.ingest(run, signal, protobuf ? 'protobuf' : 'json', body)
    } else if (signal === 'metrics') {
      await metricStorage!.insertMetrics(decodeOtlpMetrics(payload, options.metricLimits))
    } else {
      const spans = decodeOtlpJson(payload, options.traceLimits)
      const inserted = storage.insertSpansOnce ? await storage.insertSpansOnce(spans) : await storage.insertSpans(spans).then(() => spans)
      // Cold starts and the observer's own checks are stored, but do not train the anomaly detector.
      options.detector?.observe(inserted.filter((s) => !storage.isColdStart(s) && !options.checks?.isCheckTrace?.(s.traceId)))
    }
    // OTLP answers in the request's format; an empty ExportTraceServiceResponse is zero bytes in protobuf.
    if (protobuf) res.writeHead(200, { ...CORS, 'content-type': 'application/x-protobuf' }).end()
    else send(res, 200, {})
  }

  // --- proactive: detector → SSE broadcast → investigation, one at a time ---
  const subscribers = new Set<ServerResponse>()
  const recent: ProactiveEvent[] = []
  // Every turn of the chat — asked or started here — so that a reloaded page finds them again.
  const history = new ChatHistory()
  let seq = 0
  const broadcast = (message: Omit<ProactiveEvent, 'seq'>) => {
    history.start({ id: message.turnId, proactive: true, startedAtMs: message.event.type === 'anomaly' ? message.event.anomaly.detectedAtMs : Date.now(), running: options.chat !== undefined })
    history.add(message.turnId, message.event)
    const envelope: ProactiveEvent = { seq: ++seq, ...message }
    recent.push(envelope)
    if (recent.length > REPLAY_EVENTS) recent.shift()
    const line = `data: ${JSON.stringify(envelope)}\n\n`
    // A queued investigation can outlive close(): never write to an ended response.
    for (const res of subscribers) if (!res.writableEnded) res.write(line)
  }
  let investigations = Promise.resolve()
  /** Investigations the observer started itself and that are queued or running — each can be stopped by its turn id. */
  const proactive = new Map<string, AbortController>()
  let asked = 0
  const budget = options.budget ?? new InvestigationBudget()
  const onAnomalies = () => {
    for (const anomaly of [...(options.detector?.check() ?? []), ...(options.checks?.anomalies?.() ?? [])]) {
      const turnId = anomaly.id
      broadcast({ turnId, event: { type: 'anomaly', anomaly } })
      if (!options.chat) continue
      const chat = options.chat
      // The queue is looked at first: an anomaly turned away because enough are waiting must not use up the budget.
      const reason = proactive.size > MAX_WAITING ? 'queue' : budget.take(anomaly.type, Date.now()) ? undefined : 'budget'
      if (reason) {
        broadcast({ turnId, event: { type: 'noted', reason, budget: budget.state(Date.now()) } })
        continue
      }
      const controller = new AbortController()
      proactive.set(turnId, controller)
      // Queued: two investigations at once would double the model load and interleave in the UI.
      investigations = investigations
        .then(() =>
          chat.handle({ question: questionFor(anomaly), signal: controller.signal }, (event) => {
            // Already told to everyone by the stop request itself; and nothing of a stopped turn is news after that.
            if (!controller.signal.aborted) broadcast({ turnId, event })
          }).catch((error: unknown) => {
            if (!controller.signal.aborted) broadcast({ turnId, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          }),
        )
        .finally(() => proactive.delete(turnId))
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
    let body: { question?: unknown; sessionId?: unknown; turnId?: unknown }
    try {
      body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
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
    // The page names its turn, so that the copy it gets back from the history is recognised as the same one.
    if (body.turnId !== undefined && (typeof body.turnId !== 'string' || !/^[\w-]{1,100}$/.test(body.turnId))) {
      throw new HttpError(400, 'turnId must be 1–100 characters of letters, digits, _ or -')
    }
    const turnId = body.turnId !== undefined && !history.has(body.turnId) ? body.turnId : `q-${Date.now()}-${++asked}`
    history.start({ id: turnId, question, proactive: false, startedAtMs: Date.now() })

    // One JSON event per line, flushed as the agents work — the UI shows each step live.
    res.writeHead(200, { ...CORS, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' })
    const emit = (event: ChatEvent) => {
      history.add(turnId, event)
      if (!res.writableEnded) res.write(JSON.stringify(event) + '\n')
    }
    // The asker closing the connection (the Stop button, a closed tab) stops the investigation: nobody reads the answer.
    const controller = new AbortController()
    const onClose = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.on('close', onClose)
    try {
      await options.chat.handle({ question, ...(sessionId ? { sessionId } : {}), signal: controller.signal }, emit)
    } catch (error) {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      res.off('close', onClose)
      history.end(turnId)
    }
    res.end()
  }

  /** Stops an investigation the observer started on its own; one that is still queued never starts. */
  async function stopProactive(req: IncomingMessage, res: ServerResponse) {
    let body: { turnId?: unknown }
    try {
      body = JSON.parse((await readBody(req, 4096)).toString('utf8'))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'body is not valid JSON')
    }
    const turnId = typeof body?.turnId === 'string' ? body.turnId : ''
    const controller = proactive.get(turnId)
    if (!controller) throw new HttpError(404, 'no such investigation is running')
    const already = controller.signal.aborted
    controller.abort()
    // Said at once: an investigation still waiting in the queue would otherwise look alive until its turn came.
    // The handler's own `stopped`, when the queue gets to it, changes nothing for a turn that has already ended.
    if (!already) broadcast({ turnId, event: { type: 'stopped' } })
    send(res, 200, { stopped: true })
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://collector')
    const q = url.searchParams
    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end()
    if (req.method === 'POST' && url.pathname === '/v1/traces') return ingest(req, res, 'traces')
    if (req.method === 'POST' && url.pathname === '/v1/metrics') return ingest(req, res, 'metrics')
    if (options.uiPassword && url.pathname !== '/health' && !passwordMatches(req.headers.authorization, options.uiPassword)) {
      // The browser shows its own login dialog and then sends the password with every request of the page.
      return void res
        .writeHead(401, { 'www-authenticate': 'Basic realm="next-observer", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' })
        .end('next-observer: password required')
    }
    if (req.method === 'GET' && url.pathname === '/api/performance/features') return send(res, 200, { runs: Boolean(options.capture), reports: Boolean(options.performanceReports) })
    const reportRoute = /^\/api\/performance\/reports(?:\/([^/]+))?$/.exec(url.pathname)
    if (reportRoute && req.method === 'GET') {
      if (!options.performanceReports) throw new HttpError(503, 'performance reports are disabled')
      return send(res, 200, reportRoute[1] ? await options.performanceReports.get(reportRoute[1]) : await options.performanceReports.list())
    }
    const runRoute = /^\/api\/performance\/runs(?:\/([^/]+)(?:\/(finalize|spans|metrics))?)?$/.exec(url.pathname)
    if (runRoute) {
      if (!options.capture) throw new HttpError(503, 'run capture is disabled')
      const id = runRoute[1]
      const action = runRoute[2]
      if (req.method === 'POST' && !id) {
        let input: { runId?: unknown; metadata?: unknown }
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(req, 64 * 1024))) }
        catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'body is not valid JSON') }
        if (!input || typeof input.runId !== 'string') throw new HttpError(400, 'runId is required')
        return send(res, 201, await options.capture.create(input.runId, input.metadata as RunMetadata))
      }
      if (req.method === 'POST' && id && action === 'finalize') return send(res, 200, await options.capture.finalize(id))
      if (req.method !== 'GET') throw new HttpError(404, 'not found')
      if (!id) return send(res, 200, { runs: await options.capture.list() })
      if (!action) return send(res, 200, (await options.capture.read(id)).manifest)
      if (action === 'spans' || action === 'metrics') {
        let where: unknown = []
        try { if (q.has('where')) where = JSON.parse(q.get('where')!) }
        catch { throw new HttpError(400, 'where is not valid JSON') }
        return send(res, 200, await options.capture.query(id, action === 'spans' ? 'traces' : 'metrics', { where, limit: numberParam(q, 'limit'), offset: numberParam(q, 'offset') }))
      }
      throw new HttpError(404, 'not found')
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res)
    if (req.method === 'POST' && url.pathname === '/api/chat/stop') return stopProactive(req, res)
    if (req.method !== 'GET') throw new HttpError(404, 'not found')

    if (url.pathname === '/api/chat/events') return events(req, res)
    // `seq`: the page opens the event stream next and skips what the history already told it.
    if (url.pathname === '/api/chat/history') return send(res, 200, { seq, turns: history.list() })
    if (url.pathname === '/api/chat') {
      return send(res, 200, options.chat ? { enabled: true, mode: options.chat.mode, budget: budget.state(Date.now()) } : { enabled: false, reason: CHAT_DISABLED })
    }

    if (url.pathname === '/health') return send(res, 200, { status: 'ok', spans: await storage.count() })
    if (url.pathname === '/api/performance/capabilities') return send(res, 200, { metrics: Boolean(metricStorage), metricTypes: metricStorage ? ['sum', 'gauge', 'histogram'] : [], ...(options.capture ? { runs: { schema: RUN_SCHEMA, capture: true } } : {}) })
    if (url.pathname === '/api/performance/metrics') {
      if (!metricStorage) throw new HttpError(503, 'metric queries are disabled')
      const result = await metricStorage.queryMetrics({ name: stringParam(q, 'name'), service: stringParam(q, 'service'), fromMs: numberParam(q, 'fromMs'), toMs: numberParam(q, 'toMs'), limit: numberParam(q, 'limit'), offset: numberParam(q, 'offset') })
      return send(res, 200, { ...result, quantileMethod: 'explicit-bucket-linear-interpolation', points: result.points.map((m) => ({ ...m, quantiles: m.type === 'histogram' ? histogramQuantiles(m.point) : null })) })
    }
    if (url.pathname === '/api/services') return send(res, 200, await storage.getServices())
    if (url.pathname === '/api/traces') {
      return send(
        res,
        200,
        await storage.queryTraces({
          service: stringParam(q, 'service'),
          operation: stringParam(q, 'operation'),
          exactOperation: booleanParam(q, 'exactOperation'),
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
      // The UI marks the cold request: "671 ms" next to "18 ms" needs its explanation right there.
      const ids = new Set(spans.map((s) => s.spanId))
      const completeness = { historyComplete: storage.isHistoryComplete(), missingParentCount: spans.filter((s) => s.parentSpanId && !ids.has(s.parentSpanId)).length }
      return send(res, 200, { traceId: traceMatch[1], completeness, spans: spans.map((s) => (storage.isColdStart(s) ? { ...s, coldStart: true } : s)) })
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
    if (url.pathname === '/api/overview' || url.pathname === '/api/operation') {
      const windowMs = numberParam(q, 'windowMs') ?? OVERVIEW_DEFAULT_WINDOW_MS
      if (windowMs < 60_000 || windowMs > 86_400_000) throw new HttpError(400, 'windowMs must be between 60000 (1 min) and 86400000 (24 h)')
      const nowMs = numberParam(q, 'toMs') ?? Date.now()
      // Two windows: the current one and the one before it, for "since last period".
      const spans = await storage.querySpans({ fromMs: nowMs - 2 * windowMs, toMs: nowMs, limit: Number.MAX_SAFE_INTEGER })
      const options = { nowMs, windowMs, buckets: OVERVIEW_BUCKETS, service: stringParam(q, 'service'), isColdStart: (s: NormalizedSpan) => storage.isColdStart(s) }
      if (url.pathname === '/api/overview') return send(res, 200, computeOverview(spans, options))
      const operation = stringParam(q, 'operation')
      if (!operation) throw new HttpError(400, 'operation is required')
      return send(res, 200, computeOperation(spans, { ...options, operation }))
    }
    if (url.pathname === '/api/checks') {
      const report: ChecksReport = { checks: options.checks?.list() ?? [], nowMs: Date.now(), rule: options.checks?.rule ?? CHECK_RULE, investigates: Boolean(options.checks?.anomalies && options.chat) }
      return send(res, 200, report)
    }
    if (url.pathname === '/api/defects') {
      const windowMs = numberParam(q, 'windowMs') ?? OVERVIEW_DEFAULT_WINDOW_MS
      if (windowMs < 60_000 || windowMs > 86_400_000) throw new HttpError(400, 'windowMs must be between 60000 (1 min) and 86400000 (24 h)')
      const nowMs = numberParam(q, 'toMs') ?? Date.now()
      // Every failed span stored, not just the window: "first seen" and "new in v2" need the history.
      const failed = await storage.querySpans({ status: 'error', toMs: nowMs, limit: Number.MAX_SAFE_INTEGER })
      const deployOrder = new Map((await storage.getServices()).map((s) => [s.name, s.versions]))
      // Only asked when old spans were dropped: is the operation still on record in the version before the latest?
      const ran = new Set((await storage.getOperationStats({ toMs: nowMs, byVersion: true })).map((s) => `${s.service}\u0000${s.operation}\u0000${s.serviceVersion}`))
      const defects = computeDefects(failed, {
        nowMs,
        windowMs,
        buckets: OVERVIEW_BUCKETS,
        service: stringParam(q, 'service'),
        deployOrder,
        historyComplete: storage.isHistoryComplete(),
        ranIn: (service, operation, version) => ran.has(`${service}\u0000${operation}\u0000${version}`),
      })
      return send(res, 200, defects)
    }
    if (url.pathname === '/api/regression') {
      // The same window as during the traffic, counted back from the last span that arrived rather than from now: the card
      // is about the latest deploy and must not vanish a quarter of an hour after the last request to it. (A wider window
      // is no fix: it pulls older deploys into the comparison.)
      const service = stringParam(q, 'service')
      const seen = (await storage.getServices()).filter((s) => !service || s.name === service).map((s) => s.lastSeenMs)
      const lastMs = seen.length ? Math.max(...seen) : Date.now()
      const queries = createAgentQueries(storage, { now: () => Math.min(lastMs, Date.now()) })
      const { changes } = await queries.compareVersions({ service, sinceMinutes: numberParam(q, 'sinceMinutes'), integrity: false })
      return send(res, 200, { regression: findRegression(changes) })
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) throw new HttpError(404, 'not found')
    const uiDir = options.uiDir ?? DEFAULT_UI_DIR
    if (uiDir && (await serveUi(uiDir, url.pathname, res))) return
    throw new HttpError(404, 'not found')
  }

  const server: Server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) return
      const status = error instanceof HttpError || error instanceof CaptureError ? error.status : error instanceof OtlpValidationError ? 400 : 500
      const message = error instanceof HttpError || error instanceof CaptureError || error instanceof OtlpValidationError ? error.message : 'internal error'
      if (!(error instanceof HttpError) && !(error instanceof CaptureError) && !(error instanceof OtlpValidationError)) console.error('[next-observer collector]', error)
      if (req.method === 'POST' && /^\/v1\/(traces|metrics)$/.test(new URL(req.url ?? '/', 'http://collector').pathname)) {
        const failure = otlpErrorStatus(status, message)
        if (/^application\/(x-)?protobuf(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
          return void res.writeHead(status, { ...CORS, 'content-type': 'application/x-protobuf' }).end(encodeOtlpError(failure))
        }
        // Retain the legacy `error` field for callers; code/message are the OTLP JSON Status fields.
        return send(res, status, { ...failure, error: message })
      }
      send(res, status, { error: message })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4318, options.host ?? '127.0.0.1', resolve)
  })
  const detectorTimer = options.detector || options.checks?.anomalies ? setInterval(onAnomalies, options.detectorIntervalMs ?? 5000) : undefined
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
    metricStorage,
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
