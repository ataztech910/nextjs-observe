import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startCollector, type Collector } from '../src/collector/index.js'

let collector: Collector
let base: string

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'nxo-ui-'))
  const ui = join(base, 'ui')
  mkdirSync(join(ui, 'assets'), { recursive: true })
  writeFileSync(join(ui, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(ui, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(ui, 'favicon.svg'), '<svg/>')
  writeFileSync(join(base, 'secret.txt'), 'TOP SECRET') // outside the UI dir
  collector = await startCollector({ port: 0, uiDir: ui })
})
afterAll(() => collector.close())

const get = async (path: string) => {
  const res = await fetch(`${collector.url}${path}`)
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: await res.text() }
}

describe('collector serves the UI', () => {
  it('serves index.html at / without long caching', async () => {
    expect(await get('/')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8', cache: 'no-cache', body: expect.stringContaining('root') })
  })

  it('falls back to index.html for client-side routes (deep links)', async () => {
    const page = await get(`/traces/${'a'.repeat(32)}`)
    expect(page).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
  })

  it('serves hashed assets as immutable, other files with their type', async () => {
    expect(await get('/assets/index-abc123.js')).toMatchObject({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      cache: 'public, max-age=31536000, immutable',
      body: 'console.log(1)',
    })
    expect(await get('/favicon.svg')).toMatchObject({ status: 200, type: 'image/svg+xml', cache: 'no-cache' })
  })

  it('never serves files outside the UI dir', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const res = await get(path)
      expect(res.body, path).not.toContain('TOP SECRET')
    }
  })

  it('keeps API and OTLP 404s as JSON instead of the SPA fallback', async () => {
    expect(await get('/api/nope')).toMatchObject({ status: 404, type: 'application/json' })
    expect(await get('/v1/nope')).toMatchObject({ status: 404, type: 'application/json' })
    expect((await get('/api/services')).type).toBe('application/json')
  })
})

describe('collector without a UI build', () => {
  it('answers 404 JSON when the dir has no index.html, or the UI is disabled', async () => {
    for (const uiDir of [mkdtempSync(join(tmpdir(), 'nxo-empty-ui-')), false as const]) {
      const bare = await startCollector({ port: 0, uiDir })
      try {
        const res = await fetch(`${bare.url}/`)
        expect(res.status).toBe(404)
        expect(res.headers.get('content-type')).toBe('application/json')
      } finally {
        await bare.close()
      }
    }
  })
})
