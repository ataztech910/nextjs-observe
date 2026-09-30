// Real-model evals for the three workshop scenarios over the deterministic shop data.
// Skipped unless OBSERVE_AI=real (spends tokens / subscription quota):
//   OBSERVE_AI=real npx vitest run e2e/investigate.real.test.ts
import { describe, expect, it } from 'vitest'
import { createInvestigator, getModel } from '../src/agents/index.js'
import { NOW, shopStorage } from '../test/fixtures/shop.js'

const real = process.env.OBSERVE_AI === 'real'

async function investigate(question: string) {
  const investigator = createInvestigator({ storage: await shopStorage(), model: await getModel(), queryOptions: { now: () => NOW } })
  const started = Date.now()
  const result = await investigator.ask(question)
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  for (const t of result.transcript) console.log(`  [${t.kind}] ${t.agent}: ${t.content.slice(0, 500)}`)
  console.log(`\n### ${question}\n${seconds}s · ${result.steps.map((s) => `${s.agent}:${s.tool}`).join(', ')}\n${result.text}${result.error ? `\nERROR: ${result.error}` : ''}`)
  return result
}

describe.skipIf(!real)('investigator with a real model (workshop scenarios)', () => {
  it('1. slow checkout → chargePayment regressed in v2', async () => {
    const { text, steps } = await investigate("Checkout is slow. What's causing it and which deployment introduced it?")
    expect(steps.some((s) => s.tool === 'compare_versions')).toBe(true)
    expect(text).toMatch(/chargePayment/)
    expect(text).toMatch(/\bv2\b/)
    expect(text).not.toMatch(/[а-яё]/i)
  })

  it('2. failing product pages → inventory.check 30% with the exact message', async () => {
    const { text, steps } = await investigate('There are 500 errors on product pages. Which operation is failing and why?')
    expect(steps.some((s) => s.tool === 'get_errors')).toBe(true)
    expect(text).toMatch(/inventory/i)
    expect(text).toMatch(/30\s?%|0\.3\b/)
    expect(text).toMatch(/upstream not responding/i)
  })

  it('3. slow catalog, no single slow span → N+1 of db.query', async () => {
    const { text, steps } = await investigate('The product catalog (GET /api/products) is slower than expected but no single span stands out. What is wrong?')
    expect(steps.some((s) => s.tool === 'get_trace')).toBe(true)
    expect(text).toMatch(/N\+1|db\.query|repeated/i)
    expect(text).toMatch(/\b5\b|five/i)
  })
})

describe.skipIf(!real)('conversation memory with a real model', () => {
  it('4. a follow-up question uses the previous turn ("it" = chargePayment)', async () => {
    const investigator = createInvestigator({ storage: await shopStorage(), model: await getModel(), queryOptions: { now: () => NOW } })
    const t0 = Date.now()
    const first = await investigator.ask("Checkout is slow. What's the slowest operation?")
    const t1 = Date.now()
    const second = await investigator.ask('Which deployment introduced it? Give p95 before and after.', { sessionId: first.sessionId })
    const t2 = Date.now()
    console.log(`\n### turn 1 (${((t1 - t0) / 1000).toFixed(0)}s)\n${first.text}\n### turn 2 (${((t2 - t1) / 1000).toFixed(0)}s)\n${second.text}`)

    expect(first.text).toMatch(/chargePayment/)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.text).toMatch(/chargePayment/) // never named in the second question
    expect(second.text).toMatch(/\bv1\b/)
    expect(second.text).toMatch(/\bv2\b/)
    expect(second.text).toMatch(/2[,.]?[34]\d\d|2\.[34]\s?s/) // v2 p95 ≈ 2380–2490 ms
  })
})
