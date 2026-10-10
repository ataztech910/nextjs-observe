import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authLines } from '../src/cli.js'
import { startCollector, type Collector } from '../src/collector/index.js'

let collector: Collector
beforeAll(async () => {
  collector = await startCollector({ port: 0, uiPassword: 'p:ss w0rd', apiKey: 'ingest-key', chat: { mode: 'mock', handle: async () => {} } })
})
afterAll(() => collector.close())

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
const get = (path: string, authorization?: string) => fetch(`${collector.url}${path}`, { headers: authorization ? { authorization } : {} })

describe('UI password (HTTP Basic Auth)', () => {
  it('closes the UI, the query API and the chat; the browser gets a login dialog', async () => {
    for (const path of ['/', '/traces', '/api/services', '/api/traces', '/api/overview', '/api/operation?operation=x', '/api/defects', '/api/checks', '/api/regression', '/api/chat']) {
      const res = await get(path)
      expect(res.status, path).toBe(401)
      expect(res.headers.get('www-authenticate'), path).toMatch(/^Basic realm="next-observer"/)
    }
    const res = await fetch(`${collector.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"hi"}' })
    expect(res.status).toBe(401)
  })

  it('opens with the password and any user name — also a password containing ":" and spaces', async () => {
    expect((await get('/api/services', basic('anyone', 'p:ss w0rd'))).status).toBe(200)
    expect((await get('/api/services', basic('', 'p:ss w0rd'))).status).toBe(200)
  })

  it('rejects a wrong password, a missing one and other schemes', async () => {
    expect((await get('/api/services', basic('anyone', 'wrong'))).status).toBe(401)
    expect((await get('/api/services', basic('anyone', 'p:ss w0rd!'))).status).toBe(401)
    // The right credentials under another scheme are still not Basic Auth.
    expect((await get('/api/services', basic('u', 'p:ss w0rd').replace('Basic', 'Bearer'))).status).toBe(401)
    expect((await get('/api/services', `Basic ${Buffer.from('no-colon').toString('base64')}`)).status).toBe(401)
  })

  it('needs the user:password form — a bare password in the header is not accepted', async () => {
    const strict = await startCollector({ port: 0, uiPassword: 'secret', uiDir: false })
    try {
      const res = await fetch(`${strict.url}/api/services`, { headers: { authorization: `Basic ${Buffer.from('secret').toString('base64')}` } })
      expect(res.status).toBe(401)
      const ok = await fetch(`${strict.url}/api/services`, { headers: { authorization: basic('u', 'secret') } })
      expect(ok.status).toBe(200)
    } finally {
      await strict.close()
    }
  })

  it('keeps /health open for uptime checks, and ingest on its own x-api-key — not the password', async () => {
    expect((await get('/health')).status).toBe(200)
    const ingest = (headers: Record<string, string>) =>
      fetch(`${collector.url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
    expect((await ingest({ 'x-api-key': 'ingest-key' })).status).toBe(200)
    expect((await ingest({ authorization: basic('u', 'p:ss w0rd') })).status).toBe(401)
  })
})

describe('authLines (banner)', () => {
  it('warns when listening beyond this machine without protection', () => {
    expect(authLines({ host: '0.0.0.0' })).toEqual([
      expect.stringContaining('WARNING    listening on 0.0.0.0: the UI, traces and chat are open to anyone'),
      expect.stringContaining('WARNING    listening on 0.0.0.0: anyone can send traces'),
    ])
    expect(authLines({ host: '0.0.0.0', apiKey: 'k', uiPassword: 'p' })).toEqual([
      '  auth       ingest: x-api-key required',
      '  auth       UI, API and chat: password required',
    ])
    expect(authLines({ host: '127.0.0.1' })).toEqual([])
  })
})
