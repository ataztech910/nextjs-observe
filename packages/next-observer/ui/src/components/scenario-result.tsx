import { Link } from '@tanstack/react-router'
import type { ScenarioReport } from '../../../src/collector/performance-report-types'
import { Card } from '@/components/ui/card'
import { performanceNumber } from '@/lib/performance'

export function ScenarioResult({ report, search }: { report: ScenarioReport; search: { run?: string; report?: string; trace?: string; span?: string } }) {
  return <Card className="gap-4 p-5" data-testid="scenario-report">
    <h2 className="text-lg font-semibold">{report.title}</h2>
    <p className="text-sm text-muted-foreground">{report.runner} · {report.endpoint}</p>
    <p className="text-xs text-muted-foreground">Artifact hashes and capture associations checked. Checks and measurements are supplied by the external harness.</p>
    {report.runs.map((run) => <section key={run.runId} className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap gap-3"><Link to="/performance" hash="selected-run" search={{ ...search, run: run.runId, trace: undefined, span: undefined }} className="font-mono text-sm text-signal hover:underline">{run.runId}</Link><strong data-testid="scenario-status">{run.status}</strong><span className="text-sm">{run.variant} · {run.mode}</span></div>
      <ul className="space-y-1 text-sm">{run.checks.map((check) => <li key={check.name}><strong>{check.status}</strong> · {check.name}: {check.details}</li>)}</ul>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Measurement', 'Value', 'Source'].map((s) => <th key={s} className="p-2">{s}</th>)}</tr></thead><tbody>{run.measurements.map((m) => <tr key={m.name} className="border-t"><td className="p-2">{m.name}</td><td className="p-2">{m.value === null ? `Unavailable: ${m.unavailableReason}` : `${performanceNumber(m.value)} ${m.unit}`}</td><td className="p-2">{m.source}</td></tr>)}</tbody></table></div>
      <details className="text-sm"><summary className="cursor-pointer">Source artifact references</summary><ul className="space-y-2 py-3 font-mono text-xs break-all">{run.artifacts.map((a) => <li key={a.name}>{a.name}: {a.sha256}</li>)}</ul></details>
    </section>)}
    <details className="text-sm"><summary className="cursor-pointer">Protocol and limitations</summary><p className="py-2 font-mono text-xs break-all">{report.protocol.name}: {report.protocol.sha256}</p><ul className="list-disc space-y-1 pl-5">{report.limitations.map((s) => <li key={s}>{s}</li>)}</ul></details>
  </Card>
}
