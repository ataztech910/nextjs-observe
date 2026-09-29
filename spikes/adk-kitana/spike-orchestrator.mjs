// Spike 2: orchestrator that calls specialist agents as tools (AgentTool), all through Kitana → Claude CLI.
import { AgentTool, FunctionTool, InMemoryRunner, LlmAgent } from '@google/adk'
import { KitanaLlm } from '@kitana-sdk/adk'
import { z } from 'zod'

const model = () => new KitanaLlm({ model: 'auto', chain: ['claude'], models: { claude: 'sonnet' } })
const calls = []
const tool = (name, description, data) =>
  new FunctionTool({
    name,
    description,
    parameters: z.object({}),
    execute: async () => {
      calls.push(name)
      return data
    },
  })

const latencyAgent = new LlmAgent({
  name: 'latency_agent',
  description: 'Latency specialist: slow operations, p50/p95/p99 per service version.',
  model: model(),
  instruction: 'Call get_operation_stats, then report the slowest regression with exact p50/p95/p99 and the version. Max 2 sentences. Answer in English.',
  tools: [
    tool('get_operation_stats', 'Latency percentiles per operation and version.', {
      stats: [
        { operation: 'chargePayment', version: 'v1', p50Ms: 180, p95Ms: 260, p99Ms: 310 },
        { operation: 'chargePayment', version: 'v2', p50Ms: 1450, p95Ms: 2380, p99Ms: 2490 },
      ],
    }),
  ],
})

const errorAgent = new LlmAgent({
  name: 'error_agent',
  description: 'Error specialist: failing operations, error rates, exception messages.',
  model: model(),
  instruction: 'Call get_error_stats, then report the failing operation, its error rate and exact exception message. Max 2 sentences. Answer in English.',
  tools: [
    tool('get_error_stats', 'Error rate and top exception per operation.', {
      errors: [{ operation: 'inventory.check', route: '/api/inventory/[id]', count: 200, errorRate: 0.3, topException: 'Inventory service timeout: upstream not responding' }],
    }),
  ],
})

const orchestrator = new LlmAgent({
  name: 'orchestrator',
  model: model(),
  instruction: `You coordinate an investigation. Use latency_agent for slowness and error_agent for failures — call every specialist relevant to the question.
Then write one report for an on-call engineer at 3am: max 5 sentences, diagnosis only, no automated fixes. Answer in English.`,
  tools: [new AgentTool({ agent: latencyAgent }), new AgentTool({ agent: errorAgent })],
})

const started = Date.now()
let finalText = ''
for await (const event of new InMemoryRunner({ agent: orchestrator, appName: 'spike' }).runEphemeral({
  userId: 'workshop',
  newMessage: { role: 'user', parts: [{ text: 'Users say checkout is slow and product pages sometimes fail. What is going on?' }] },
})) {
  for (const part of event.content?.parts ?? []) {
    if (part.functionCall) console.log(`[${event.author}] → ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`)
    if (part.functionResponse) console.log(`[${event.author}] ← ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response).slice(0, 300)}`)
    if (part.text && event.author === 'orchestrator') finalText = part.text
  }
}

console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s, leaf tool calls: ${JSON.stringify(calls)}\n\n${finalText}\n`)
const checks = {
  'both specialists ran their tools': calls.includes('get_operation_stats') && calls.includes('get_error_stats'),
  'report names chargePayment + v2': /chargePayment/.test(finalText) && /\bv2\b/.test(finalText),
  'report names inventory + 30%': /inventory/i.test(finalText) && /30\s?%|0\.3\b/.test(finalText),
  'report quotes the exception': /upstream not responding/i.test(finalText),
  'report is in English': !/[а-яё]/i.test(finalText),
}
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
