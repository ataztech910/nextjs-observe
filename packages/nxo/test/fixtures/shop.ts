// The workshop "shop" scenario at a fixed clock, for deterministic tests.
import { MemoryStorage } from '../../src/collector/memory-storage.js'
import { demoSpans, seedDemo } from '../../src/debug/demo.js'

export const NOW = 1_800_000_000_000

export const shopSpans = () => demoSpans(NOW)

export async function shopStorage(): Promise<MemoryStorage> {
  const storage = new MemoryStorage()
  await seedDemo(storage, NOW)
  return storage
}
