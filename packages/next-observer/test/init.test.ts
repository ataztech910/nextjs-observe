import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectPackageManager, init, installArgs, wrapNextConfig, type PackageManager } from '../src/init.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'next-observer-init-'))

// Syntax checks for the rewritten configs with Node itself (it strips TypeScript types since 22.18).
function nodeCheck(source: string, ext: 'mjs' | 'cjs' | 'ts') {
  const file = join(tmp(), `next.config.${ext}`)
  writeFileSync(file, source)
  return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status
}
const tsErrors = (source: string) => nodeCheck(source, 'ts')

describe('wrapNextConfig', () => {
  it('create-next-app TypeScript config: variable export', () => {
    const source = `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  /* config options here */\n};\n\nexport default nextConfig;\n`
    const out = wrapNextConfig(source, false)!
    expect(out).toContain(`import { withObserve } from 'next-observe/config'`)
    // The variable export is wrapped in place, no extra alias.
    expect(out).not.toContain('nextObserveConfig')
    expect(out.trimEnd().endsWith('export default withObserve(nextConfig)')).toBe(true)
    expect(tsErrors(out)).toBe(0)
  })

  it('any exported expression: a multi-line object, a function config, satisfies', () => {
    const object = `export default {\n  reactStrictMode: true,\n  images: { domains: ['a.b'] },\n}\n`
    expect(nodeCheck(wrapNextConfig(object, false)!, 'mjs')).toBe(0)
    const fn = `export default async function config(phase) {\n  return { env: { PHASE: phase } }\n}\n`
    expect(nodeCheck(wrapNextConfig(fn, false)!, 'mjs')).toBe(0)
    const satisfies = `import type { NextConfig } from 'next'\nexport default { reactStrictMode: true } satisfies NextConfig\n`
    expect(tsErrors(wrapNextConfig(satisfies, false)!)).toBe(0)
  })

  it('CommonJS: module.exports', () => {
    const out = wrapNextConfig(`/** @type {import('next').NextConfig} */\nconst nextConfig = {}\nmodule.exports = nextConfig\n`, true)!
    expect(out).toContain(`const { withObserve } = require('next-observe/config')`)
    expect(out.trimEnd().endsWith('module.exports = withObserve(nextConfig)')).toBe(true)
    expect(nodeCheck(out, 'cjs')).toBe(0)
    const literal = wrapNextConfig(`module.exports = {\n  reactStrictMode: true,\n}\n`, true)!
    expect(literal.trimEnd().endsWith('module.exports = withObserve(nextObserveConfig)')).toBe(true)
    expect(nodeCheck(literal, 'cjs')).toBe(0)
  })

  it('leaves an already wrapped config as is, and gives up on anything it cannot rewrite with certainty', () => {
    const wrapped = `import { withObserve } from 'next-observe/config'\nexport default withObserve({})\n`
    expect(wrapNextConfig(wrapped, false)).toBe(wrapped)
    expect(wrapNextConfig(`const a = {}\nexport { a as default }\n`, false)).toBeUndefined()
    // The syntax check itself must catch a broken file, or the checks above prove nothing.
    expect(nodeCheck(`const a: = {\n`, 'ts')).not.toBe(0)
    expect(wrapNextConfig(`export default {}\nexport default {}\n`, false)).toBeUndefined()
  })
})

describe('detectPackageManager', () => {
  it('follows the lockfile, npm by default', () => {
    const lock = (name?: string) => {
      const dir = tmp()
      if (name) writeFileSync(join(dir, name), '')
      return detectPackageManager(dir)
    }
    expect([lock(), lock('package-lock.json'), lock('pnpm-lock.yaml'), lock('yarn.lock'), lock('bun.lock')]).toEqual(['npm', 'npm', 'pnpm', 'yarn', 'bun'])
  })
})

// A fresh create-next-app: app/, tsconfig.json, next.config.ts, no instrumentation.
function nextApp(options: { src?: boolean; config?: [string, string]; packageType?: string } = {}) {
  const root = tmp()
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'shop', ...(options.packageType ? { type: options.packageType } : {}), scripts: { dev: 'next dev' }, dependencies: { next: '16.3.8', react: '19.3.0' } }, null, 2))
  writeFileSync(join(root, 'tsconfig.json'), '{}')
  mkdirSync(join(root, options.src ? 'src/app' : 'app'), { recursive: true })
  const [name, content] = options.config ?? ['next.config.ts', `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`]
  writeFileSync(join(root, name), content)
  return root
}

// Stands in for `npm install next-observe`: records the call and adds the dependency like npm would.
function fakeInstall(ok = true) {
  const calls: PackageManager[] = []
  const install = async (root: string, pm: PackageManager) => {
    calls.push(pm)
    if (!ok) return false
    const file = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    pkg.dependencies['next-observe'] = '^0.3.0'
    writeFileSync(file, JSON.stringify(pkg, null, 2))
    return true
  }
  return { calls, install }
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

describe('init', () => {
  it('connects a fresh create-next-app: install, config, server + browser instrumentation, script', async () => {
    const root = nextApp()
    const { calls, install } = fakeInstall()
    const changes = await init({ root, observerRange: '^0.2', install })
    expect(calls).toEqual(['npm'])
    expect(changes.map((c) => [c.file, c.action])).toEqual([
      ['package.json', 'updated'],
      ['next.config.ts', 'updated'],
      ['instrumentation.ts', 'created'],
      ['instrumentation-client.ts', 'created'],
      ['package.json', 'updated'],
    ])
    expect(read(root, 'next.config.ts')).toContain('export default withObserve(nextConfig)')
    expect(read(root, 'instrumentation.ts')).toBe(`export { register } from 'next-observe/server'\n`)
    expect(read(root, 'instrumentation-client.ts')).toBe(`import 'next-observe/client'\n`)
    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts).toEqual({ dev: 'next dev', observe: 'npx --yes --prefer-offline next-observer@^0.2 dev' })
    expect(pkg.dependencies['next-observe']).toBe('^0.3.0')
  })

  it('is safe to run again: everything unchanged, nothing installed twice', async () => {
    const root = nextApp()
    await init({ root, observerRange: '^0.2', install: fakeInstall().install })
    const before = ['next.config.ts', 'instrumentation.ts', 'instrumentation-client.ts', 'package.json'].map((f) => read(root, f))
    const again = fakeInstall()
    const changes = await init({ root, observerRange: '^0.2', install: again.install })
    expect(again.calls).toEqual([])
    expect(changes.every((c) => c.action === 'unchanged')).toBe(true)
    expect(['next.config.ts', 'instrumentation.ts', 'instrumentation-client.ts', 'package.json'].map((f) => read(root, f))).toEqual(before)
  })

  it('puts the instrumentation files in src/ when the app lives in src/app, and the proxy route with --proxy', async () => {
    const root = nextApp({ src: true })
    await init({ root, observerRange: '^0.2', install: fakeInstall().install, proxy: true })
    expect(existsSync(join(root, 'src/instrumentation.ts'))).toBe(true)
    expect(existsSync(join(root, 'src/instrumentation-client.ts'))).toBe(true)
    expect(existsSync(join(root, 'instrumentation.ts'))).toBe(false)
    expect(read(root, 'src/app/api/next-observe/[...path]/route.ts')).toBe(`export { POST } from 'next-observe/proxy'\n`)
  })

  it('never overwrites an existing register(): reports a manual step and leaves the file as it was', async () => {
    const root = nextApp()
    const own = `export async function register() {\n  await import('./sentry')\n}\n`
    writeFileSync(join(root, 'instrumentation.ts'), own)
    const changes = await init({ root, observerRange: '^0.2', install: fakeInstall().install })
    expect(read(root, 'instrumentation.ts')).toBe(own)
    expect(changes.find((c) => c.file === 'instrumentation.ts')).toMatchObject({ action: 'manual', note: expect.stringContaining("from 'next-observe/server'") })
  })

  it('adds the browser import on top of an existing instrumentation-client file, keeping its code', async () => {
    const root = nextApp()
    writeFileSync(join(root, 'instrumentation-client.ts'), `console.log('analytics')\n`)
    await init({ root, observerRange: '^0.2', install: fakeInstall().install })
    expect(read(root, 'instrumentation-client.ts')).toBe(`import 'next-observe/client'\nconsole.log('analytics')\n`)
  })

  it('CommonJS next.config.js is wrapped with require; a config it cannot rewrite is a manual step, untouched', async () => {
    const cjs = nextApp({ config: ['next.config.js', `const nextConfig = {}\nmodule.exports = nextConfig\n`] })
    await init({ root: cjs, observerRange: '^0.2', install: fakeInstall().install })
    expect(read(cjs, 'next.config.js')).toContain(`module.exports = withObserve(nextConfig)`)

    const explicit = nextApp({ config: ['next.config.cjs', `module.exports = { reactStrictMode: true }\n`], packageType: 'module' })
    await init({ root: explicit, observerRange: '^0.2', install: fakeInstall().install })
    // .cjs is CommonJS even in a "type": "module" package.
    expect(nodeCheck(read(explicit, 'next.config.cjs'), 'cjs')).toBe(0)
    expect(read(explicit, 'next.config.cjs')).toContain('module.exports = withObserve(nextObserveConfig)')

    const odd = `const a = {}\nexport { a as default }\n`
    const root = nextApp({ config: ['next.config.mjs', odd] })
    const changes = await init({ root, observerRange: '^0.2', install: fakeInstall().install })
    expect(read(root, 'next.config.mjs')).toBe(odd)
    expect(changes.find((c) => c.file === 'next.config.mjs')?.action).toBe('manual')
  })

  it('reports a failed install as a manual step and still connects the files', async () => {
    const root = nextApp()
    const changes = await init({ root, observerRange: '^0.2', install: fakeInstall(false).install })
    expect(changes[0]).toMatchObject({ action: 'manual', note: expect.stringContaining('npm install next-observe') })
    expect(existsSync(join(root, 'instrumentation.ts'))).toBe(true)
  })

  it('a JavaScript app without next.config gets next.config.mjs, never a .ts file', async () => {
    const root = nextApp()
    for (const f of ['tsconfig.json', 'next.config.ts']) rmSync(join(root, f))
    await init({ root, observerRange: '^0.2', install: fakeInstall().install })
    expect(existsSync(join(root, 'next.config.ts'))).toBe(false)
    expect(nodeCheck(read(root, 'next.config.mjs'), 'mjs')).toBe(0)
    expect(existsSync(join(root, 'instrumentation.js'))).toBe(true)
  })

  it('refuses folders that are not Next.js apps', async () => {
    const empty = tmp()
    await expect(init({ root: empty, observerRange: '^0.2', install: fakeInstall().install })).rejects.toThrow('no package.json')
    writeFileSync(join(empty, 'package.json'), '{"dependencies":{"express":"5"}}')
    await expect(init({ root: empty, observerRange: '^0.2', install: fakeInstall().install })).rejects.toThrow('no "next" dependency')
  })
})

describe('installArgs', () => {
  it('uses the cache when the package manager is known to accept the flag', () => {
    expect(installArgs('npm')).toEqual(['install', 'next-observe', '--prefer-offline'])
    expect(installArgs('pnpm')).toEqual(['add', 'next-observe', '--prefer-offline'])
    expect(installArgs('bun')).toEqual(['add', 'next-observe', '--prefer-offline'])
  })

  it('yarn gets no flag: berry fails on it and cannot be told from classic by the lockfile', () => {
    expect(installArgs('yarn')).toEqual(['add', 'next-observe'])
  })
})
