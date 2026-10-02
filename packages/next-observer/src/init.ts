// `next-observer init` — connects a Next.js app to next-observe in one command. Safe to run twice: files that are already
// connected are left alone, and anything it cannot rewrite with certainty is reported as a manual step, never guessed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export type InitAction = 'created' | 'updated' | 'unchanged' | 'manual'

export interface InitChange {
  file: string
  action: InitAction
  note: string
}

export interface InitOptions {
  root: string
  /** Also create the runtime proxy route for browser spans (production: destination and keys read at runtime). */
  proxy?: boolean
  /** The observer version range for the package.json script, e.g. "^0.2". */
  observerRange: string
  /** Installs next-observe with the project's package manager; returns false on failure. */
  install: (root: string, packageManager: PackageManager) => Promise<boolean>
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'
  return 'npm'
}

const CONFIG_FILES = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js', 'next.config.cjs']
const LOCAL = 'nextObserveConfig'

/**
 * Wraps the exported Next config in withObserve(). The exported expression may be anything (an object, a variable, a
 * function, a call), so it is not parsed: `export default <expr>` becomes `const nextObserveConfig = <expr>` and the
 * export moves to the end. Returns undefined when the file has no single recognisable export.
 */
export function wrapNextConfig(source: string, commonJs: boolean): string | undefined {
  if (/\bwithObserve\b/.test(source)) return source
  const pattern = commonJs ? /^module\.exports\s*=\s*/gm : /^export\s+default\s+/gm
  const matches = source.match(pattern)
  if (!matches || matches.length !== 1) return undefined
  const importLine = commonJs ? `const { withObserve } = require('next-observe/config')` : `import { withObserve } from 'next-observe/config'`
  // The common case — create-next-app's `export default nextConfig` — becomes `export default withObserve(nextConfig)`.
  const identifier = commonJs ? /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m : /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m
  const simple = identifier.exec(source)
  if (simple) {
    const exported = commonJs ? `module.exports = withObserve(${simple[1]})` : `export default withObserve(${simple[1]})`
    return `${importLine}\n${source.replace(identifier, exported).trimEnd()}\n`
  }
  const body = source.replace(pattern, `const ${LOCAL} = `).trimEnd()
  if (commonJs) {
    return `const { withObserve } = require('next-observe/config')\n${body}\n\nmodule.exports = withObserve(${LOCAL})\n`
  }
  return `import { withObserve } from 'next-observe/config'\n${body}\n\nexport default withObserve(${LOCAL})\n`
}

function isCommonJs(file: string, source: string, packageType: string | undefined): boolean {
  if (file.endsWith('.cjs')) return true
  if (file.endsWith('.mjs') || file.endsWith('.mts') || file.endsWith('.ts')) return false
  // next.config.js: CommonJS unless the package is "type": "module" or the file uses ESM syntax.
  return packageType !== 'module' && !/^export\s+default\s+/m.test(source)
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export async function init(options: InitOptions): Promise<InitChange[]> {
  const { root } = options
  const changes: InitChange[] = []
  const rel = (file: string) => relative(root, file) || file
  const write = (file: string, content: string) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  const packageFile = join(root, 'package.json')
  if (!existsSync(packageFile)) throw new Error(`no package.json in ${root} — run init in the app folder or pass --root <dir>`)
  const pkg = readJson(packageFile)
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (!deps.next) throw new Error(`${rel(packageFile)} has no "next" dependency — init is for Next.js apps`)

  // 1. The instrumentation package (into the app; the observer itself stays outside it, run with npx).
  if (deps['next-observe']) changes.push({ file: 'package.json', action: 'unchanged', note: 'next-observe is already a dependency' })
  else {
    const pm = detectPackageManager(root)
    if (await options.install(root, pm)) changes.push({ file: 'package.json', action: 'updated', note: `${pm} added next-observe` })
    else changes.push({ file: 'package.json', action: 'manual', note: `installing failed — run \`${pm} ${pm === 'npm' ? 'install' : 'add'} next-observe\`` })
  }

  const typescript = existsSync(join(root, 'tsconfig.json'))

  // 2. next.config: wrap the exported config in withObserve().
  const configFile = CONFIG_FILES.map((f) => join(root, f)).find(existsSync)
  if (!configFile) {
    // TypeScript projects get next.config.ts; plain JS ones an ES module that works whatever "type" package.json has.
    const file = join(root, typescript ? 'next.config.ts' : 'next.config.mjs')
    write(
      file,
      typescript
        ? `import type { NextConfig } from 'next'\nimport { withObserve } from 'next-observe/config'\n\nconst nextConfig: NextConfig = {}\n\nexport default withObserve(nextConfig)\n`
        : `import { withObserve } from 'next-observe/config'\n\nexport default withObserve({})\n`,
    )
    changes.push({ file: rel(file), action: 'created', note: 'with withObserve()' })
  } else {
    const source = readFileSync(configFile, 'utf8')
    const wrapped = wrapNextConfig(source, isCommonJs(configFile, source, pkg.type))
    if (wrapped === source) changes.push({ file: rel(configFile), action: 'unchanged', note: 'already uses withObserve()' })
    else if (wrapped === undefined) {
      changes.push({ file: rel(configFile), action: 'manual', note: "wrap the exported config: `export default withObserve(config)` (import { withObserve } from 'next-observe/config')" })
    } else {
      write(configFile, wrapped)
      changes.push({ file: rel(configFile), action: 'updated', note: 'exported config wrapped in withObserve()' })
    }
  }

  // 3–4. Instrumentation files next to app/ — in src/ when the app lives in src/app.
  const base = existsSync(join(root, 'src', 'app')) || existsSync(join(root, 'src', 'pages')) ? join(root, 'src') : root
  const ext = typescript ? 'ts' : 'js'
  const findFile = (name: string) => ['ts', 'js', 'mjs', 'mts'].map((e) => join(base, `${name}.${e}`)).find(existsSync)

  const server = findFile('instrumentation')
  if (!server) {
    const file = join(base, `instrumentation.${ext}`)
    write(file, `export { register } from 'next-observe/server'\n`)
    changes.push({ file: rel(file), action: 'created', note: 'server traces' })
  } else if (readFileSync(server, 'utf8').includes('next-observe/server')) {
    changes.push({ file: rel(server), action: 'unchanged', note: 'already registers next-observe' })
  } else {
    // An existing register() may do other things — merging code automatically could break it.
    changes.push({ file: rel(server), action: 'manual', note: "call next-observe from your register(): `import { register as observe } from 'next-observe/server'` and `observe()` inside it" })
  }

  const client = findFile('instrumentation-client')
  if (!client) {
    const file = join(base, `instrumentation-client.${ext}`)
    write(file, `import 'next-observe/client'\n`)
    changes.push({ file: rel(file), action: 'created', note: 'browser traces' })
  } else {
    const source = readFileSync(client, 'utf8')
    if (source.includes('next-observe/client')) changes.push({ file: rel(client), action: 'unchanged', note: 'already imports next-observe/client' })
    else {
      // A side-effect import at the top is safe to add to any client instrumentation file.
      write(client, `import 'next-observe/client'\n${source}`)
      changes.push({ file: rel(client), action: 'updated', note: 'imports next-observe/client' })
    }
  }

  // 5. Optional runtime proxy route for browser spans.
  if (options.proxy) {
    const appDir = existsSync(join(root, 'src', 'app')) ? join(root, 'src', 'app') : join(root, 'app')
    const file = join(appDir, 'api', 'next-observe', '[...path]', `route.${ext}`)
    if (existsSync(file)) changes.push({ file: rel(file), action: 'unchanged', note: 'proxy route exists' })
    else {
      write(file, `export { POST } from 'next-observe/proxy'\n`)
      changes.push({ file: rel(file), action: 'created', note: 'runtime proxy for browser spans' })
    }
  }

  // 6. A script to start the app together with the observer, without installing the observer into the app.
  const fresh = readJson(packageFile)
  if (fresh.scripts?.observe) changes.push({ file: 'package.json', action: 'unchanged', note: 'script "observe" exists' })
  else {
    fresh.scripts = { ...fresh.scripts, observe: `npx --yes next-observer@${options.observerRange} dev` }
    const indent = /^(\s+)"/m.exec(readFileSync(packageFile, 'utf8'))?.[1] ?? '  '
    write(packageFile, `${JSON.stringify(fresh, null, indent)}\n`)
    changes.push({ file: 'package.json', action: 'updated', note: 'script "observe": next dev + the observer' })
  }

  return changes
}
