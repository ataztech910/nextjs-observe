import { z } from 'zod'
import { RUN_ID } from './run-manifest.js'
import type { ScenarioReport } from './performance-report-types.js'
const text = z.string().min(1).max(1000)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const artifact = z.strictObject({ name: text, sha256: hash })
const status = z.enum(['passed', 'failed', 'incomplete'])
export const scenarioReportSchema = z.strictObject({
  schema: z.literal('observe.scenario-report/v1'), id: z.string().regex(RUN_ID), title: text, endpoint: text,
  runner: z.enum(['playwright', 'maestro']), protocol: artifact, limitations: z.array(text).min(1).max(100),
  runs: z.array(z.strictObject({
    runId: z.string().regex(RUN_ID), variant: text, mode: text,
    manifestFile: z.enum(['run.json', 'finalized.json']), manifestSha256: hash, status,
    checks: z.array(z.strictObject({ name: text, status, details: text })).min(1).max(100),
    measurements: z.array(z.strictObject({ name: text, value: z.number().finite().nullable(), unit: text, source: text, unavailableReason: text.nullable() }).superRefine((m, ctx) => {
      if ((m.value === null) !== (m.unavailableReason !== null)) ctx.addIssue({ code: 'custom', message: 'missing measurements require a reason; measured values must not have one' })
    })).max(100),
    artifacts: z.array(artifact).min(1).max(100),
  }).superRefine((run, ctx) => {
    const expected = run.checks.some((c) => c.status === 'failed') ? 'failed' : run.checks.some((c) => c.status === 'incomplete') ? 'incomplete' : 'passed'
    if (run.status !== expected || run.status === 'passed' && run.manifestFile !== 'finalized.json') ctx.addIssue({ code: 'custom', message: 'scenario status contradicts checks/capture' })
    for (const items of [run.checks, run.measurements, run.artifacts]) if (new Set(items.map((i) => i.name)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'duplicate scenario item name' })
  })).min(1).max(100),
}).superRefine((report, ctx) => {
  if (new Set(report.runs.map((r) => r.runId)).size !== report.runs.length) ctx.addIssue({ code: 'custom', message: 'duplicate run' })
}) satisfies z.ZodType<ScenarioReport>
