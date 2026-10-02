// Runs the agent tools over real spans: starts a collector, waits until ingestion goes quiet, prints every tool's output.
//   node e2e/agent-tools.mjs   then drive the app (nxo-less: OBSERVE_ENDPOINT=http://127.0.0.1:4318 next dev)
import { startCollector } from 'nxo/collector'
import { createAgentQueries } from 'nxo/debug'

const collector = await startCollector({ port: Number(process.env.OBSERVE_PORT ?? 4318), uiDir: false })
console.log(`[agent-tools] collector ${collector.url}, waiting for spans…`)

let last = -1
let quietFor = 0
while (true) {
  await new Promise((r) => setTimeout(r, 1000))
  const count = await collector.storage.count()
  quietFor = count > 0 && count === last ? quietFor + 1 : 0
  last = count
  if (quietFor >= 8) break
}

const q = createAgentQueries(collector.storage)
const [first] = (await q.searchTraces({ operation: 'render ObservePage', limit: 1 })).traces
const outputs = {
  getServices: await q.getServices(),
  getOperationStats: await q.getOperationStats({ limit: 8 }),
  compareVersions: await q.compareVersions(),
  getErrors: await q.getErrors(),
  searchTraces: await q.searchTraces({ limit: 5 }),
  getTrace: first ? await q.getTrace({ traceId: first.traceId }) : 'no render ObservePage trace',
}
for (const [name, output] of Object.entries(outputs)) {
  const json = JSON.stringify(output)
  console.log(`\n=== ${name} (${json.length} chars)\n${JSON.stringify(output, null, 1)}`)
}
await collector.close()
