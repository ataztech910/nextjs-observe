// `next-observer` CLI — the observer for apps instrumented with next-observe. Pure logic lives here; bin.ts wires real process I/O.
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { MemoryStorage, startCollector, type Collector, type CollectorOptions } from './collector/index.js'
import { seedDemo, startLiveDemo } from './debug/demo.js'
import { detectPackageManager, init, installArgs, type InitChange, type PackageManager } from './init.js'
import { CheckRunner } from './checks/runner.js'
import { validateChecks } from './checks/spec.js'
import { AnomalyDetector } from './debug/detector.js'

// Type-only: the agents module (and @google/adk behind it) is loaded lazily, so `next-observer --help` stays instant.
type AgentsModule = typeof import('./agents/index.js')

export const HELP = `Usage:
  next-observer init [--root <dir>] [--proxy]
      Connect a Next.js app to next-observe: install it, wrap next.config in withObserve(), add instrumentation.ts and
      instrumentation-client.ts, and an "observe" script. Safe to run again. --proxy also adds the runtime proxy route.

  next-observer dev [--root <dir>] [--port <n>] [-- <next dev args>]
      Start the collector and \`next dev\` for the app in <dir> (default: current directory).
      Example: next-observer dev --root apps/web -- -p 3100

  next-observer collector [--host <host>] [--port <n>] [--api-key <key>] [--ui-password <password>] [--demo]
      Start only the collector (e.g. on a server). Reads OBSERVE_HOST, OBSERVE_PORT, OBSERVE_API_KEY, OBSERVE_UI_PASSWORD.
      --api-key protects ingest (x-api-key); --ui-password protects the UI, API and chat (browser login).
      --demo preloads the workshop "shop" scenario (a regression in v2, 30% inventory errors, an N+1, an error new in v2).

Environment: OBSERVE_ROOT, OBSERVE_PORT (default 4318), OBSERVE_HOST (default 127.0.0.1), OBSERVE_API_KEY,
             OBSERVE_AI (mock | real), OBSERVE_DETECTOR (off to disable the anomaly detector),
             OBSERVE_APP_URL (where the checks from observe.checks.ts are sent; default http://localhost:3000),
             OBSERVE_MODEL_TIMEOUT_MS (one model call; default 90000, a call that hangs is started again once)`

export class CliError extends Error {}

export type Env = Record<string, string | undefined>

export interface CliArgs {
  command: 'init' | 'dev' | 'collector' | 'help'
  root: string
  port: number
  host: string
  apiKey?: string
  uiPassword?: string
  demo: boolean
  proxy: boolean
  nextArgs: string[]
}

export function parseCliArgs(argv: string[], env: Env, cwd: string): CliArgs {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const nextArgs = separator === -1 ? [] : argv.slice(separator + 1)

  let parsed
  try {
    parsed = parseArgs({
      args: own,
      allowPositionals: true,
      options: {
        root: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        'api-key': { type: 'string' },
        'ui-password': { type: 'string' },
        demo: { type: 'boolean' },
        proxy: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    throw new CliError((error as Error).message)
  }
  const { values, positionals } = parsed

  const command = values.help || positionals.length === 0 ? 'help' : positionals[0]
  if (command !== 'init' && command !== 'dev' && command !== 'collector' && command !== 'help') throw new CliError(`unknown command "${command}"`)

  const rawPort = values.port ?? env.OBSERVE_PORT ?? '4318'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`invalid port "${rawPort}"`)

  return {
    command,
    root: resolve(cwd, values.root ?? env.OBSERVE_ROOT ?? '.'),
    port,
    host: values.host ?? env.OBSERVE_HOST ?? '127.0.0.1',
    apiKey: values['api-key'] ?? env.OBSERVE_API_KEY,
    uiPassword: values['ui-password'] ?? env.OBSERVE_UI_PASSWORD,
    demo: values.demo ?? false,
    proxy: values.proxy ?? false,
    nextArgs,
  }
}

export interface CliDeps {
  env: Env
  cwd: string
  log: (line: string) => void
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  /** Resolves when the CLI should stop (SIGINT/SIGTERM in real use). */
  shutdownSignal: Promise<string>
  /** Replaces init() in tests. */
  init?: typeof init
  /** Loads the agents module; injectable for tests. */
  loadAgents?: () => Promise<AgentsModule>
}

function resolveNextBin(root: string): string {
  if (!existsSync(join(root, 'package.json'))) throw new CliError(`no package.json in ${root} — pass --root <app dir>`)
  try {
    const nextPackage = createRequire(join(root, 'package.json')).resolve('next/package.json')
    return join(dirname(nextPackage), 'dist', 'bin', 'next')
  } catch {
    throw new CliError(`next is not installed in ${root} — run npm install there first`)
  }
}

export const AGENTS_FILES = ['observe.agents.ts', 'observe.agents.mts', 'observe.agents.js', 'observe.agents.mjs']

export const CHECKS_FILES = ['observe.checks.ts', 'observe.checks.mts', 'observe.checks.js', 'observe.checks.mjs']

/** The default export of the one file from `names` that exists in the app root; `{}` when there is none. */
async function importProjectFile(root: string, names: string[]): Promise<{ file?: string; exported?: unknown }> {
  const found = names.filter((name) => existsSync(join(root, name)))
  if (found.length === 0) return {}
  if (found.length > 1) throw new CliError(`found ${found.join(' and ')} in ${root} — keep one`)
  const file = found[0]
  // Next apps rarely have "type": "module", so Node warns that it reparses the .ts file as ESM — noise, not a problem.
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const code = (rest[0] as { code?: string } | undefined)?.code
    if (code === 'MODULE_TYPELESS_PACKAGE_JSON' && String(warning).includes(file)) return
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    return { file, exported: (await import(pathToFileURL(join(root, file)).href)).default }
  } catch (error) {
    const e = error as NodeJS.ErrnoException
    if (e?.code === 'ERR_UNKNOWN_FILE_EXTENSION') throw new CliError(`${file}: this Node.js cannot load TypeScript — use Node.js ≥22.18 or rename it to ${file.replace(/\.m?ts$/, '.mjs')}`)
    throw new CliError(`${file}: ${e?.message ?? String(error)}`)
  } finally {
    process.emitWarning = emitWarning
  }
}

/**
 * Where checks with a path go: OBSERVE_APP_URL, else the host and port `next dev` was given (-H, -p, PORT), else
 * localhost:3000. A guess: when that port is busy `next dev` moves to the next free one without telling us — the banner
 * names the address so it can be compared with the one Next prints.
 */
export function appUrl(env: Env, nextArgs: string[] = []): string {
  const given = env.OBSERVE_APP_URL
  if (given) {
    const url = /^https?:\/\//i.test(given) && URL.canParse(given) ? new URL(given) : undefined
    // Judged on the text too: `http://host?` parses with an empty query and would turn every path into one.
    if (!url || /[?#]/.test(given) || url.username || url.password) throw new CliError(`invalid OBSERVE_APP_URL "${given}" — expected something like http://localhost:3000`)
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  }
  let port = env.PORT
  let host = 'localhost'
  // The value after a flag — unless what follows is the next flag (`-H --turbo`).
  const valueAfter = (i: number) => (nextArgs[i + 1]?.startsWith('-') === false ? nextArgs[i + 1] : undefined)
  nextArgs.forEach((arg, i) => {
    if (arg === '-p' || arg === '--port') port = valueAfter(i) ?? port
    else if (arg.startsWith('--port=')) port = arg.slice('--port='.length)
    else if (/^-p\d+$/.test(arg)) port = arg.slice(2)
    else if (arg === '-H' || arg === '--hostname') host = valueAfter(i) ?? host
    else if (arg.startsWith('--hostname=')) host = arg.slice('--hostname='.length)
  })
  // "All interfaces" is not an address to call.
  if (host === '0.0.0.0' || host === '::' || !/^[\w.-]+$/.test(host)) host = 'localhost'
  return `http://${host}:${port && /^\d+$/.test(port) ? port : '3000'}`
}

/** The checks from observe.checks.* in the app root (`export default [{ name, url, expect }]`), ready to run. */
async function loadChecks(root: string, env: Env, nextArgs: string[]): Promise<{ runner?: CheckRunner; line?: string }> {
  const { file, exported } = await importProjectFile(root, CHECKS_FILES)
  if (!file) return {}
  let checks
  try {
    checks = validateChecks(exported)
  } catch (error) {
    throw new CliError(`${file}: ${(error as Error).message}`)
  }
  if (checks.length === 0) return {}
  const own = checks.some((c) => c.url.startsWith('/'))
  // Asked for only when a check needs it: a wrong OBSERVE_APP_URL nobody uses is not a reason to refuse to start.
  const baseUrl = own ? appUrl(env, nextArgs) : ''
  const runner = new CheckRunner({ checks, baseUrl })
  return { runner, line: `  checks     ${file}: ${checks.length} ${checks.length === 1 ? 'check' : 'checks'}${own ? ` against ${baseUrl}` : ''}` }
}

type SpecialistSpec = import('./agents/index.js').SpecialistSpec

/**
 * The project's own specialists from observe.agents.* in the app root: `export default [defineSpecialist({…})]`.
 * Same name as a built-in replaces it, a new name adds a specialist. Node ≥22.18 runs the .ts file as is (type stripping).
 */
async function loadProjectSpecialists(root: string, agents: AgentsModule): Promise<{ file?: string; specs: SpecialistSpec[] }> {
  const { file, exported } = await importProjectFile(root, AGENTS_FILES)
  if (!file) return { specs: [] }
  const list = Array.isArray(exported) ? exported : exported === undefined ? undefined : [exported]
  if (!list) throw new CliError(`${file}: export default an array of defineSpecialist({…})`)
  const specs: SpecialistSpec[] = []
  for (const item of list) {
    try {
      specs.push(agents.defineSpecialist(item as SpecialistSpec))
    } catch (error) {
      throw new CliError(`${file}: ${(error as Error).message}`)
    }
  }
  const names = specs.map((s) => s.name)
  const duplicate = names.find((name, i) => names.indexOf(name) !== i)
  if (duplicate) throw new CliError(`${file}: specialist "${duplicate}" is defined twice`)
  return { file, specs }
}

function agentsLine(builtIn: SpecialistSpec[], file: string, project: SpecialistSpec[]): string {
  const builtInNames = new Set(builtIn.map((s) => s.name))
  const own = project.map((s) => (builtInNames.has(s.name) ? `${s.name} (replaces built-in)` : s.name))
  const kept = builtIn.filter((s) => !project.some((p) => p.name === s.name)).map((s) => s.name)
  return `  agents     ${file}: ${own.join(', ')}${kept.length ? `; built-in: ${kept.join(', ')}` : ''}`
}

async function loadChat(storage: MemoryStorage, root: string, deps: CliDeps): Promise<{ chat: CollectorOptions['chat']; line: string }> {
  const agents = await (deps.loadAgents ?? (() => import('./agents/index.js')))()
  const project = await loadProjectSpecialists(root, agents)
  const specialists = agents.mergeSpecialists(agents.BUILT_IN_SPECIALISTS, project.specs)
  try {
    const chat = await agents.createChatHandler({ storage, env: deps.env, specialists })
    const hint = chat.mode === 'mock' ? '  (OBSERVE_AI=real for a real model)' : ''
    const line = `  chat       ${chat.mode}${hint}`
    return { chat, line: project.file ? `${line}\n${agentsLine(agents.BUILT_IN_SPECIALISTS, project.file, project.specs)}` : line }
  } catch (error) {
    throw new CliError((error as Error).message)
  }
}

async function start(args: CliArgs, deps: CliDeps): Promise<{ collector: Collector; chatLine: string; stop: () => Promise<void> }> {
  const storage = new MemoryStorage()
  if (args.demo) await seedDemo(storage)
  const { chat, line: chatLine } = await loadChat(storage, args.root, deps)
  const detector = deps.env.OBSERVE_DETECTOR === 'off' ? undefined : new AnomalyDetector()
  const lines = [chatLine]
  if (detector) {
    const o = detector.options
    lines.push(`  detector   errors > ${o.errorRate * 100}%, slow (>${o.slowMs}ms) > ${o.slowRate * 100}%, silence > ${o.noTrafficMs / 1000}s → agents investigate on their own`)
  } else lines.push('  detector   off (OBSERVE_DETECTOR=off)')
  const { runner: checks, line: checksLine } = await loadChecks(args.root, deps.env, args.nextArgs)
  if (checksLine) lines.push(checksLine)
  if (args.demo) lines.push('  demo       "shop" scenario: v1 → v2 regression, inventory errors, catalog N+1, an error new in v2 — live v2 traffic every 2 s')
  const line = lines.join('\n')
  try {
    const collector = await startCollector({ port: args.port, host: args.host, apiKey: args.apiKey, uiPassword: args.uiPassword, storage, chat, detector, checks })
    checks?.start()
    const stopDemo = args.demo ? startLiveDemo({ storage, detector }) : undefined
    return {
      collector,
      chatLine: line,
      stop: async () => {
        stopDemo?.()
        checks?.stop()
        await collector.close()
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new CliError(`port ${args.port} is already in use — is another next-observer running? Use --port <n>`)
    }
    throw error
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** What protects the collector — and a warning when it listens beyond this machine with an open UI. */
export function authLines(args: Pick<CliArgs, 'host' | 'apiKey' | 'uiPassword'>): string[] {
  const lines: string[] = []
  if (args.apiKey) lines.push('  auth       ingest: x-api-key required')
  if (args.uiPassword) lines.push('  auth       UI, API and chat: password required')
  if (!LOCAL_HOSTS.has(args.host)) {
    if (!args.uiPassword) lines.push(`  WARNING    listening on ${args.host}: the UI, traces and chat are open to anyone who can reach it — set --ui-password`)
    if (!args.apiKey) lines.push(`  WARNING    listening on ${args.host}: anyone can send traces — set --api-key`)
  }
  return lines
}

function banner(collector: Collector, extra: string[] = []): string {
  return [
    'next-observer',
    `  ui         ${collector.url}`,
    `  collector  ${collector.url}  (OTLP: /v1/traces, API: /api/traces, /api/operations, /api/services)`,
    ...extra,
  ].join('\n')
}

async function runCollector(args: CliArgs, deps: CliDeps): Promise<number> {
  const { collector, chatLine, stop } = await start(args, deps)
  deps.log(banner(collector, [chatLine, ...authLines(args)]))
  await deps.shutdownSignal
  await stop()
  return 0
}

async function runDev(args: CliArgs, deps: CliDeps): Promise<number> {
  const nextBin = resolveNextBin(args.root)
  const { collector, chatLine, stop } = await start(args, deps)
  deps.log(banner(collector, [chatLine, `  app        ${['next dev', ...args.nextArgs].join(' ')} in ${args.root}`]))

  const child = deps.spawn(process.execPath, [nextBin, 'dev', ...args.nextArgs], {
    cwd: args.root,
    stdio: 'inherit',
    // Points both register() and the /__observe browser proxy (withObserve) at this collector.
    // Next's global types make NODE_ENV required on ProcessEnv; a plain env map is what spawn really takes.
    env: { ...deps.env, OBSERVE_ENDPOINT: collector.url } as unknown as NodeJS.ProcessEnv,
  })
  const exited = new Promise<number>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code ?? 0))
    child.once('error', () => resolveExit(1))
  })

  const first = await Promise.race([exited.then((code) => ({ code })), deps.shutdownSignal.then(() => null)])
  let code: number
  if (first) {
    code = first.code
  } else {
    if (child.exitCode === null) child.kill('SIGTERM')
    await exited
    code = 0
  }
  await stop()
  return code
}

/** "^0.2" for 0.2.x — the range the app's "observe" script asks npx for. */
function ownRange(): string {
  const { version } = createRequire(import.meta.url)('../package.json') as { version: string }
  const [major, minor] = version.split('.')
  return major === '0' ? `^0.${minor}` : `^${major}`
}

async function runInit(args: CliArgs, deps: CliDeps): Promise<number> {
  const runInstall = (root: string, pm: PackageManager, installCommand: string[]) =>
    new Promise<boolean>((resolveInstall) => {
      const child = deps.spawn(pm, installCommand, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
      child.once('exit', (code) => resolveInstall(code === 0))
      child.once('error', () => resolveInstall(false))
    })
  // From the cache first (a workshop's Wi-Fi). The cache can be inconsistent right after a release — npm then fails
  // with "No matching version" although the registry has it — so a failure is tried once more the plain way.
  const install = async (root: string, pm: PackageManager) => {
    const preferred = installArgs(pm)
    const plain = preferred.filter((arg) => arg !== '--prefer-offline')
    return (await runInstall(root, pm, preferred)) || (plain.length !== preferred.length && (await runInstall(root, pm, plain)))
  }
  let changes: InitChange[]
  try {
    changes = await (deps.init ?? init)({ root: args.root, proxy: args.proxy, observerRange: ownRange(), install })
  } catch (error) {
    throw new CliError((error as Error).message)
  }
  const width = Math.max(...changes.map((c) => c.file.length))
  deps.log(['next-observer init', ...changes.map((c) => `  ${c.action.padEnd(9)} ${c.file.padEnd(width)}  ${c.note}`)].join('\n'))
  const manual = changes.filter((c) => c.action === 'manual').length
  const start = `${detectPackageManager(args.root)} run observe`
  deps.log(
    manual
      ? `\n${manual} step(s) to do by hand (above). Then: ${start}`
      : `\nDone. Start the app with the observer:  ${start}   — traces and the AI agents' chat at http://127.0.0.1:4318`,
  )
  return 0
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  try {
    const args = parseCliArgs(argv, deps.env, deps.cwd)
    if (args.command === 'help') {
      deps.log(HELP)
      return 0
    }
    if (args.command === 'init') return await runInit(args, deps)
    return await (args.command === 'dev' ? runDev(args, deps) : runCollector(args, deps))
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    deps.log(`next-observer: ${error.message}\n\n${HELP}`)
    return 1
  }
}
