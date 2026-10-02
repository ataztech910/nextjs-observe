import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CliError, HELP, parseCliArgs, run, type CliDeps, type Env } from '../src/cli.js'
import { startCollector } from '../src/collector/index.js'

// A project dir with a resolvable `next` package, like a real app after npm install.
function fixtureApp(withNext = true): string {
  const root = mkdtempSync(join(tmpdir(), 'nxo-app-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-app' }))
  if (withNext) {
    mkdirSync(join(root, 'node_modules', 'next', 'dist', 'bin'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'next', 'package.json'), JSON.stringify({ name: 'next', version: '16.0.0' }))
    writeFileSync(join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), '')
  }
  return root
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  killedWith: string | null = null
  kill(signal: string) {
    this.killedWith = signal
    setImmediate(() => this.emit('exit', null, signal))
    return true
  }
  exit(code: number) {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

function harness(env: Env = {}) {
  const logs: string[] = []
  const spawned: { command: string; args: string[]; options: SpawnOptions; child: FakeChild }[] = []
  let stop!: (signal: string) => void
  const deps: CliDeps = {
    env,
    cwd: '/work',
    log: (line) => logs.push(line),
    spawn: (command, args, options) => {
      const child = new FakeChild()
      spawned.push({ command, args, options, child })
      return child as unknown as ChildProcess
    },
    shutdownSignal: new Promise((resolve) => (stop = resolve)),
  }
  const collectorUrl = () => logs.join('\n').match(/collector\s+(http:\/\/\S+)/)?.[1]
  return { deps, logs, spawned, stop: (s = 'SIGINT') => stop(s), collectorUrl }
}

const until = async (condition: () => unknown) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!condition()) throw new Error('condition not met')
}
const reachable = (url: string) => fetch(`${url}/health`).then(() => true, () => false)

describe('parseCliArgs', () => {
  it('shows help without a command', () => {
    expect(parseCliArgs([], {}, '/work').command).toBe('help')
    expect(parseCliArgs(['dev', '-h'], {}, '/work').command).toBe('help')
  })

  it('resolves --root against cwd and passes args after -- to next dev', () => {
    expect(parseCliArgs(['dev', '--root', 'apps/web', '--', '-p', '3100'], {}, '/work')).toEqual({
      command: 'dev',
      root: '/work/apps/web',
      port: 4318,
      host: '127.0.0.1',
      apiKey: undefined,
      demo: false,
      proxy: false,
      nextArgs: ['-p', '3100'],
    })
    expect(parseCliArgs(['dev', '--root=apps/web'], {}, '/work').root).toBe('/work/apps/web')
  })

  it('reads env for cloud use, flags win over env', () => {
    const env = { OBSERVE_ROOT: 'site', OBSERVE_PORT: '9000', OBSERVE_HOST: '0.0.0.0', OBSERVE_API_KEY: 'k' }
    expect(parseCliArgs(['collector'], env, '/work')).toMatchObject({ root: '/work/site', port: 9000, host: '0.0.0.0', apiKey: 'k' })
    expect(parseCliArgs(['collector', '--port', '9100'], env, '/work').port).toBe(9100)
  })

  it('rejects bad input with CliError', () => {
    expect(() => parseCliArgs(['deploy'], {}, '/w')).toThrow(CliError)
    expect(() => parseCliArgs(['dev', '--port', 'abc'], {}, '/w')).toThrow('invalid port "abc"')
    expect(() => parseCliArgs(['dev', '--port', '70000'], {}, '/w')).toThrow(CliError)
    expect(() => parseCliArgs(['dev', '--nope'], {}, '/w')).toThrow(CliError)
  })
})

describe('run: help and errors', () => {
  it('prints help and exits 0', async () => {
    const h = harness()
    expect(await run([], h.deps)).toBe(0)
    expect(h.logs).toEqual([HELP])
  })

  it('prints the error plus help and exits 1', async () => {
    const h = harness()
    expect(await run(['deploy'], h.deps)).toBe(1)
    expect(h.logs[0]).toMatch(/^next-observer: unknown command "deploy"/)
  })

  it('explains a busy port', async () => {
    const busy = await startCollector({ port: 0 })
    try {
      const h = harness()
      expect(await run(['collector', '--port', String(busy.port)], h.deps)).toBe(1)
      expect(h.logs[0]).toContain(`port ${busy.port} is already in use`)
    } finally {
      await busy.close()
    }
  })
})

describe('run collector', () => {
  it('serves until the shutdown signal, then closes', async () => {
    const h = harness({ OBSERVE_API_KEY: 'secret' })
    const exit = run(['collector', '--port', '0'], h.deps)
    await until(h.collectorUrl)
    const url = h.collectorUrl()!
    expect(await reachable(url)).toBe(true)
    expect(h.logs[0]).toContain('x-api-key required')
    const unauthorized = await fetch(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(unauthorized.status).toBe(401)

    h.stop()
    expect(await exit).toBe(0)
    expect(await reachable(url)).toBe(false)
  })
})

describe('run dev', () => {
  it('starts the collector, then next dev in the app with OBSERVE_ENDPOINT pointing at it', async () => {
    const root = fixtureApp()
    const h = harness({ PATH: '/bin', OBSERVE_ENDPOINT: 'https://prod.example.com' })
    const exit = run(['dev', '--root', root, '--port', '0', '--', '-p', '3100'], h.deps)
    await until(() => h.spawned.length)

    const [{ command, args, options, child }] = h.spawned
    expect(command).toBe(process.execPath)
    // require.resolve returns the real path (on macOS tmpdir is a symlink to /private/var)
    expect(args).toEqual([join(realpathSync(root), 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '3100'])
    expect(options.cwd).toBe(root)
    expect(options.stdio).toBe('inherit')
    expect(options.env).toMatchObject({ PATH: '/bin', OBSERVE_ENDPOINT: h.collectorUrl() })
    expect(await reachable(h.collectorUrl()!)).toBe(true)

    child.exit(3)
    expect(await exit).toBe(3)
    expect(await reachable(h.collectorUrl()!)).toBe(false)
  })

  it('on Ctrl+C stops next dev and the collector', async () => {
    const h = harness()
    const exit = run(['dev', '--root', fixtureApp(), '--port', '0'], h.deps)
    await until(() => h.spawned.length)
    h.stop('SIGINT')
    expect(await exit).toBe(0)
    expect(h.spawned[0].child.killedWith).toBe('SIGTERM')
    expect(await reachable(h.collectorUrl()!)).toBe(false)
  })

  it('fails clearly without package.json or without next, and starts nothing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nxo-empty-'))
    const h1 = harness()
    expect(await run(['dev', '--root', empty, '--port', '0'], h1.deps)).toBe(1)
    expect(h1.logs[0]).toContain('no package.json')

    const h2 = harness()
    expect(await run(['dev', '--root', fixtureApp(false), '--port', '0'], h2.deps)).toBe(1)
    expect(h2.logs[0]).toContain('next is not installed')
    expect([...h1.spawned, ...h2.spawned]).toHaveLength(0)
  })
})

describe('chat in the CLI', () => {
  it('enables chat in mock mode when @google/adk is installed', async () => {
    const h = harness({})
    const exit = run(['collector', '--port', '0'], h.deps)
    await until(h.collectorUrl)
    expect(h.logs[0]).toMatch(/chat\s+mock\s+\(OBSERVE_AI=real for a real model\)/)
    expect(await (await fetch(`${h.collectorUrl()}/api/chat`)).json()).toEqual({ enabled: true, mode: 'mock' })
    h.stop()
    expect(await exit).toBe(0)
  })

  it('fails clearly on a bad OBSERVE_AI', async () => {
    const bad = harness({ OBSERVE_AI: 'bogus' })
    expect(await run(['collector', '--port', '0'], bad.deps)).toBe(1)
    expect(bad.logs[0]).toContain('OBSERVE_AI must be "mock" or "real"')
  })
})

describe('project agents (observe.agents.*)', () => {
  const cacheAgent = `{ name: 'cache_agent', description: 'Cache specialist', instruction: 'Check versions.', tools: ['get_services'] }`

  function project(files: Record<string, string>): string {
    const root = fixtureApp(false)
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
    return root
  }

  async function start(root: string) {
    const h = harness({})
    const exit = run(['collector', '--port', '0', '--root', root], h.deps)
    return { h, exit }
  }

  it('loads a .ts file, merges it with the built-ins and lists it in the banner', async () => {
    // Type annotations prove the file goes through TypeScript stripping, not plain JS.
    const root = project({ 'observe.agents.ts': `const agents: object[] = [${cacheAgent}, { name: 'latency_agent', description: 'Mine', instruction: 'Mine.', tools: ['compare_versions'] as string[] }]\nexport default agents\n` })
    const { h, exit } = await start(root)
    await until(h.collectorUrl)
    expect(h.logs[0]).toContain('  agents     observe.agents.ts: cache_agent, latency_agent (replaces built-in); built-in: error_agent, traffic_agent')

    const response = await fetch(`${h.collectorUrl()}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What is going on?' }) })
    const body = await response.text()
    expect(body).toContain('"agent":"cache_agent","tool":"get_services"')
    expect(body).toContain('"agent":"latency_agent","tool":"compare_versions"')
    expect(body).not.toContain('"agent":"latency_agent","tool":"get_operation_stats"')
    h.stop()
    expect(await exit).toBe(0)
  })

  it('accepts a single default export from .mjs', async () => {
    const { h, exit } = await start(project({ 'observe.agents.mjs': `export default ${cacheAgent}\n` }))
    await until(h.collectorUrl)
    expect(h.logs[0]).toContain('observe.agents.mjs: cache_agent; built-in: latency_agent, error_agent, traffic_agent')
    h.stop()
    expect(await exit).toBe(0)
  })

  it('without a file the banner has no agents line', async () => {
    const { h, exit } = await start(project({}))
    await until(h.collectorUrl)
    expect(h.logs[0]).not.toMatch(/^  agents /m)
    h.stop()
    expect(await exit).toBe(0)
  })

  it.each([
    [{ 'observe.agents.mjs': `export default [{ ${cacheAgent.slice(1, -1)}, tools: ['run_sql'] }]` }, 'observe.agents.mjs: specialist "cache_agent": unknown tools run_sql'],
    [{ 'observe.agents.mjs': `export default [${cacheAgent}, ${cacheAgent}]` }, 'observe.agents.mjs: specialist "cache_agent" is defined twice'],
    [{ 'observe.agents.mjs': 'export const x = 1' }, 'observe.agents.mjs: export default an array of defineSpecialist'],
    [{ 'observe.agents.mjs': 'export default [' }, 'observe.agents.mjs: '],
    [{ 'observe.agents.mjs': `export default ${cacheAgent}`, 'observe.agents.ts': `export default ${cacheAgent}` }, 'found observe.agents.ts and observe.agents.mjs'],
  ])('fails with a clear message %#', async (files, message) => {
    const h = harness({})
    expect(await run(['collector', '--port', '0', '--root', project(files)], h.deps)).toBe(1)
    expect(h.logs[0]).toContain(message)
  })
})

describe('init', () => {
  it('installs next-observe with the project\'s package manager and prints what changed', async () => {
    const root = fixtureApp(false)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { next: '16.3.8' } }))
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    const h = harness({})
    const exit = run(['init', '--root', root], h.deps)
    await until(() => h.spawned.length === 1)
    expect(h.spawned[0]).toMatchObject({ command: 'pnpm', args: ['add', 'next-observe'], options: { cwd: root } })
    h.spawned[0].child.exit(0)
    expect(await exit).toBe(0)
    const out = h.logs.join('\n')
    // No tsconfig.json: a JavaScript app gets JavaScript files only.
    expect(out).toMatch(/created\s+next\.config\.mjs/)
    expect(out).toMatch(/created\s+instrumentation\.js\s+server traces/)
    expect(out).toMatch(/created\s+instrumentation-client\.js\s+browser traces/)
    expect(out).toContain('pnpm run observe')
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.observe).toMatch(/^npx --yes next-observer@\^0\.\d+ dev$/)
  })

  it('fails clearly outside a Next.js app', async () => {
    const h = harness({})
    expect(await run(['init', '--root', mkdtempSync(join(tmpdir(), 'not-next-'))], h.deps)).toBe(1)
    expect(h.logs[0]).toContain('no package.json')
  })
})

describe('--demo', () => {
  it('preloads the shop scenario so the UI and chat have data without an app', async () => {
    const h = harness({})
    const exit = run(['collector', '--port', '0', '--demo'], h.deps)
    await until(h.collectorUrl)
    expect(h.logs[0]).toContain('demo       "shop" scenario: v1 → v2 regression, inventory errors, catalog N+1 — live v2 traffic every 2 s')
    const services = await (await fetch(`${h.collectorUrl()}/api/services`)).json()
    expect(services[0]).toMatchObject({ name: 'shop', versions: ['v0', 'v1', 'v2'] })
    h.stop()
    expect(await exit).toBe(0)
  })

  it('keeps sending v2 traffic, so the shop never looks silent', async () => {
    const h = harness({ OBSERVE_DETECTOR: 'off' })
    const exit = run(['collector', '--port', '0', '--demo'], h.deps)
    await until(h.collectorUrl)
    const spans = async () => ((await (await fetch(`${h.collectorUrl()}/api/services`)).json()) as { spanCount: number }[])[0].spanCount
    const before = await spans()
    await new Promise((r) => setTimeout(r, 2300))
    expect(await spans()).toBeGreaterThan(before)
    h.stop()
    expect(await exit).toBe(0)
  })
})

describe('detector in the CLI', () => {
  it('is on by default with its thresholds in the banner, and can be turned off', async () => {
    const on = harness({})
    const exit = run(['collector', '--port', '0'], on.deps)
    await until(on.collectorUrl)
    expect(on.logs[0]).toContain('detector   errors > 20%, slow (>1000ms) > 30%, silence > 120s → agents investigate on their own')
    on.stop()
    await exit

    const off = harness({ OBSERVE_DETECTOR: 'off' })
    const exit2 = run(['collector', '--port', '0'], off.deps)
    await until(off.collectorUrl)
    expect(off.logs[0]).toContain('detector   off (OBSERVE_DETECTOR=off)')
    off.stop()
    await exit2
  })
})
