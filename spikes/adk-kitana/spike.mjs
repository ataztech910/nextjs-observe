// Spike: does @google/adk 2.x + @kitana-sdk/adk (Claude CLI) run an agent that calls a tool and uses its result?
import { FunctionTool, InMemoryRunner, LlmAgent } from '@google/adk'
import { KitanaLlm } from '@kitana-sdk/adk'
import { z } from 'zod'

// Synthetic aggregates shaped like our collector's /api/operations; chargePayment regressed in v2.
const STATS = [
  { service: 'shop', version: 'v1', operation: 'chargePayment', count: 120, errorRate: 0, p50Ms: 180, p95Ms: 260, p99Ms: 310 },
  { service: 'shop', version: 'v2', operation: 'chargePayment', count: 118, errorRate: 0, p50Ms: 1450, p95Ms: 2380, p99Ms: 2490 },
  { service: 'shop', version: 'v2', operation: 'GET /api/products', count: 300, errorRate: 0, p50Ms: 45, p95Ms: 70, p99Ms: 90 },
]

const toolCalls = []
const getOperationStats = new FunctionTool({
  name: 'get_operation_stats',
  description: 'Latency percentiles and error rate per operation and service version. Optional filter by operation name substring.',
  parameters: z.object({ operation: z.string().optional().describe('substring of the operation name') }),
  execute: async ({ operation }) => {
    toolCalls.push({ operation })
    const matched = STATS.filter((s) => !operation || s.operation.toLowerCase().includes(operation.toLowerCase()))
    // Users say "checkout", spans say "chargePayment": an empty result makes the agent give up, so show everything instead.
    if (matched.length === 0) return { note: `no operation matches "${operation}", showing all operations`, stats: STATS }
    return { stats: matched }
  },
})

const agent = new LlmAgent({
  name: 'latency_agent',
  model: new KitanaLlm({ model: 'auto', chain: ['claude'], models: { claude: 'sonnet' } }),
  instruction: `You are a latency specialist for a Next.js app.
Always call get_operation_stats before answering. Report p50/p95/p99 with exact numbers from the tool.
Compare service versions when more than one is present. Answer in at most 3 sentences.`,
  tools: [getOperationStats],
})

const runner = new InMemoryRunner({ agent, appName: 'spike' })
const started = Date.now()
let finalText = ''
for await (const event of runner.runEphemeral({
  userId: 'workshop',
  newMessage: { role: 'user', parts: [{ text: 'Checkout is slow. Which operation and which deployment caused it?' }] },
})) {
  for (const part of event.content?.parts ?? []) {
    if (part.functionCall) console.log(`[${event.author}] → call ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`)
    if (part.functionResponse) console.log(`[${event.author}] ← ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response).slice(0, 120)}…`)
    if (part.text) {
      console.log(`[${event.author}] text: ${part.text}`)
      finalText = part.text
    }
  }
}
const seconds = ((Date.now() - started) / 1000).toFixed(1)

const checks = {
  'tool was called': toolCalls.length > 0,
  'answer names chargePayment': /chargePayment/.test(finalText),
  'answer names v2': /\bv2\b/.test(finalText),
  'answer cites real p99 (2490)': /2[,.]?490/.test(finalText),
}
console.log(`\n${seconds}s, tool calls: ${JSON.stringify(toolCalls)}`)
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
