// Read-only external analysis artifacts, separate from OTLP receive/storage and from instrumentation.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CaptureError, RUN_ID } from './run-manifest.js'
import { scenarioReportSchema } from './scenario-report.js'
import type { PerformanceComparisonReport, ExperimentReport, PerformanceReportList } from './performance-report-types.js'
export type { PerformanceReport, PerformanceReportList, PerformanceReportHeader, ExperimentReport, ScenarioReport, PerformanceComparisonReport } from './performance-report-types.js'
import type { RunCapture } from './capture.js'

const text = z.string().min(1).max(1000)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(RUN_ID)
const count = z.number().int().nonnegative().max(1_000_000)
const duration = z.number().finite().nonnegative()
const artifact = z.strictObject({ sha256: hash, name: text })
const summary = z.strictObject({ count, p50Ms: duration.nullable(), p75Ms: duration.nullable(), p95Ms: duration.nullable(), minMs: duration.nullable(), maxMs: duration.nullable() }).superRefine((s, ctx) => {
  const values = [s.minMs, s.p50Ms, s.p75Ms, s.p95Ms, s.maxMs]
  if (s.count === 0 ? values.some((v) => v !== null) : values.some((v, i) => v === null || i > 0 && values[i - 1]! > v!)) ctx.addIssue({ code: 'custom', message: 'inconsistent sample summary' })
})
const comparisonReportSchema = z.strictObject({
  schema: z.literal('observe.performance-report/v1'), id, title: text,
  endpoint: text, analysisUnit: z.literal('run-median'), algorithm: text,
  protocol: artifact,
  runs: z.array(z.strictObject({ runId: id, variant: text, mode: text, block: count, warmup: count, samples: summary, manifestSha256: hash, sampleArtifact: artifact })).min(1).max(500),
  groups: z.array(z.strictObject({ variant: text, mode: text, runIds: z.array(id).min(1).max(500), medianOfRunMediansMs: duration, minRunMedianMs: duration, maxRunMedianMs: duration })).min(1).max(100),
  limitations: z.array(text).min(1).max(100),
}).superRefine((report, ctx) => {
  const ids = report.runs.map((r) => r.runId)
  const memberships = report.groups.flatMap((g) => g.runIds)
  if (new Set(ids).size !== ids.length || new Set(memberships).size !== memberships.length || memberships.length !== ids.length || memberships.some((i) => !ids.includes(i))) ctx.addIssue({ code: 'custom', message: 'duplicate/missing run or group membership' })
  if (new Set(report.groups.map((g) => `${g.variant}\0${g.mode}`)).size !== report.groups.length) ctx.addIssue({ code: 'custom', message: 'duplicate group' })
  for (const g of report.groups) {
    if (g.minRunMedianMs > g.medianOfRunMediansMs || g.medianOfRunMediansMs > g.maxRunMedianMs || g.runIds.some((i) => !report.runs.some((r) => r.runId === i && r.variant === g.variant && r.mode === g.mode && r.samples.count > 0))) ctx.addIssue({ code: 'custom', message: 'inconsistent group' })
  }
}) satisfies z.ZodType<PerformanceComparisonReport>
export const performanceReportSchema = z.union([comparisonReportSchema, scenarioReportSchema])
const sha256 = (body: Uint8Array) => createHash('sha256').update(body).digest('hex')
async function read(path: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of createReadStream(path)) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new CaptureError(413, 'performance report artifact exceeds byte budget')
      chunks.push(chunk)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CaptureError(404, 'performance report or artifact not found')
    throw error
  }
  return Buffer.concat(chunks, bytes)
}
/** Directory contains <report-id>.json and hash-addressed artifacts/<sha256>. No user-supplied filesystem paths. */
export class PerformanceReports {
  readonly directory: string
  constructor(directory: string, private readonly capture: RunCapture) { this.directory = resolve(directory) }
  async get(reportId: string): Promise<ExperimentReport> {
    if (!RUN_ID.test(reportId)) throw new CaptureError(400, 'invalid performance report ID')
    let input: unknown
    try { input = JSON.parse((await read(join(this.directory, `${reportId}.json`))).toString('utf8')) }
    catch (e) { if (e instanceof CaptureError) throw e; throw new CaptureError(400, 'invalid performance report JSON') }
    const result = performanceReportSchema.safeParse(input)
    if (!result.success || result.data.id !== reportId) throw new CaptureError(400, 'invalid or incompatible performance report schema')
    const report = result.data
    let totalBytes = 0
    const checked = new Set<string>()
    for (const reference of [report.protocol, ...(report.schema === 'observe.scenario-report/v1' ? report.runs.flatMap((r) => r.artifacts) : report.runs.map((r) => r.sampleArtifact))]) {
      if (checked.has(reference.sha256)) continue
      const body = await read(join(this.directory, 'artifacts', reference.sha256))
      totalBytes += body.length
      if (totalBytes > 64 * 1024 * 1024) throw new CaptureError(413, 'performance report exceeds artifact byte budget')
      if (sha256(body) !== reference.sha256) throw new CaptureError(400, 'performance report artifact hash mismatch')
      checked.add(reference.sha256)
    }
    // Narrow the union before iterating so the legacy comparison contract stays unchanged.
    const verifyRun = async (run: { runId: string; manifestSha256: string; variant: string; mode: string }, file: 'run.json' | 'finalized.json', requireComplete: boolean) => {
      const manifestBytes = await read(join(this.capture.directory, run.runId, file))
      if (sha256(manifestBytes) !== run.manifestSha256) throw new CaptureError(400, 'performance report manifest hash mismatch')
      const { manifest } = await this.capture.read(run.runId)
      const stateMismatch = (file === 'finalized.json') !== (manifest.status === 'finalized')
      const incomplete = requireComplete && (manifest.status !== 'finalized' || manifest.incompleteReasons.length > 0)
      const associationMismatch = manifest.metadata.variant !== run.variant || manifest.metadata.labels.mode !== run.mode || manifest.metadata.labels['protocol.sha256'] !== report.protocol.sha256
      if (stateMismatch || incomplete || associationMismatch) throw new CaptureError(400, 'performance report run association mismatch or incomplete capture')
    }
    if (report.schema === 'observe.scenario-report/v1') {
      for (const run of report.runs) await verifyRun(run, run.manifestFile, run.status === 'passed')
    } else {
      for (const run of report.runs) await verifyRun(run, 'finalized.json', true)
    }
    return report
  }
  async list(): Promise<PerformanceReportList> {
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { reports: [], errors: [] }; throw e }
    const ids = names.filter((name) => name.endsWith('.json') && RUN_ID.test(name.slice(0, -5))).map((name) => name.slice(0, -5)).sort()
    if (ids.length > 100) throw new CaptureError(413, 'more than 100 performance reports in directory')
    const result: PerformanceReportList = { reports: [], errors: [] }
    for (const reportId of ids) {
      try {
        const report = await this.get(reportId)
        result.reports.push({ id: report.id, title: report.title, endpoint: report.endpoint, runCount: report.runs.length })
      } catch (e) { if (!(e instanceof CaptureError)) throw e; result.errors.push({ id: reportId, message: e.message }) }
    }
    return result
  }
}
