// `nxo` / `next-observe` CLI. Pure logic lives here; bin.ts wires real process I/O.
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { MemoryStorage, startCollector, type Collector, type CollectorOptions } from './collector/index.js'
import { seedDemo } from './debug/demo.js'
import { AnomalyDetector } from './debug/detector.js'

// Type-only: the agents module (and @google/adk behind it) is loaded lazily, it's an optional peer dependency.
type AgentsModule = typeof import('./agents/index.js')

export const HELP = `Usage:
  nxo dev [--root <dir>] [--port <n>] [-- <next dev args>]
      Start the collector and \`next dev\` for the app in <dir> (default: current directory).
      Example: nxo dev --root apps/web -- -p 3100

  nxo collector [--host <host>] [--port <n>] [--api-key <key>] [--demo]
      Start only the collector (e.g. on a server). Reads OBSERVE_HOST, OBSERVE_PORT, OBSERVE_API_KEY.
      --demo preloads the workshop "shop" scenario (a regression in v2, 30% inventory errors, an N+1).

Environment: OBSERVE_ROOT, OBSERVE_PORT (default 4318), OBSERVE_HOST (default 127.0.0.1), OBSERVE_API_KEY,
             OBSERVE_AI (mock | real), OBSERVE_DETECTOR (off to disable the anomaly detector)`

export class CliError extends Error {}

export type Env = Record<string, string | undefined>

export interface CliArgs {
  command: 'dev' | 'collector' | 'help'
  root: string
  port: number
  host: string
  apiKey?: string
  demo: boolean
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
        demo: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    throw new CliError((error as Error).message)
  }
  const { values, positionals } = parsed

  const command = values.help || positionals.length === 0 ? 'help' : positionals[0]
  if (command !== 'dev' && command !== 'collector' && command !== 'help') throw new CliError(`unknown command "${command}"`)

  const rawPort = values.port ?? env.OBSERVE_PORT ?? '4318'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`invalid port "${rawPort}"`)

  return {
    command,
    root: resolve(cwd, values.root ?? env.OBSERVE_ROOT ?? '.'),
    port,
    host: values.host ?? env.OBSERVE_HOST ?? '127.0.0.1',
    apiKey: values['api-key'] ?? env.OBSERVE_API_KEY,
    demo: values.demo ?? false,
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
  /** Loads the agents module; injectable so tests can simulate a project without @google/adk. */
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

const CHAT_INSTALL_HINT = 'npm i -D @google/adk @kitana-sdk/adk @google/genai'

function isMissing(error: unknown, pkg: string): boolean {
  const e = error as NodeJS.ErrnoException
  return (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') && String(e.message).includes(pkg)
}

export const AGENTS_FILES = ['observe.agents.ts', 'observe.agents.mts', 'observe.agents.js', 'observe.agents.mjs']

type SpecialistSpec = import('./agents/index.js').SpecialistSpec

/**
 * The project's own specialists from observe.agents.* in the app root: `export default [defineSpecialist({…})]`.
 * Same name as a built-in replaces it, a new name adds a specialist. Node ≥22.18 runs the .ts file as is (type stripping).
 */
async function loadProjectSpecialists(root: string, agents: AgentsModule): Promise<{ file?: string; specs: SpecialistSpec[] }> {
  const found = AGENTS_FILES.filter((name) => existsSync(join(root, name)))
  if (found.length === 0) return { specs: [] }
  if (found.length > 1) throw new CliError(`found ${found.join(' and ')} in ${root} — keep one`)
  const file = found[0]
  let exported: unknown
  // Next apps rarely have "type": "module", so Node warns that it reparses observe.agents.ts as ESM — noise, not a problem.
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const code = (rest[0] as { code?: string } | undefined)?.code
    if (code === 'MODULE_TYPELESS_PACKAGE_JSON' && String(warning).includes(file)) return
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    exported = (await import(pathToFileURL(join(root, file)).href)).default
  } catch (error) {
    const e = error as NodeJS.ErrnoException
    if (e?.code === 'ERR_UNKNOWN_FILE_EXTENSION') throw new CliError(`${file}: this Node.js cannot load TypeScript — use Node.js ≥22.18 or rename it to observe.agents.mjs`)
    throw new CliError(`${file}: ${e?.message ?? String(error)}`)
  } finally {
    process.emitWarning = emitWarning
  }
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

// Chat needs the optional @google/adk; without it the collector still runs, chat is just off.
async function loadChat(storage: MemoryStorage, root: string, deps: CliDeps): Promise<{ chat?: CollectorOptions['chat']; line: string }> {
  let agents: AgentsModule
  try {
    agents = await (deps.loadAgents ?? (() => import('./agents/index.js')))()
  } catch (error) {
    if (isMissing(error, '@google/adk')) return { line: `  chat       disabled — ${CHAT_INSTALL_HINT}` }
    throw error
  }
  const project = await loadProjectSpecialists(root, agents)
  const specialists = agents.mergeSpecialists(agents.BUILT_IN_SPECIALISTS, project.specs)
  try {
    const chat = await agents.createChatHandler({ storage, env: deps.env, specialists })
    const hint = chat.mode === 'mock' ? '  (OBSERVE_AI=real for a real model)' : ''
    const line = `  chat       ${chat.mode}${hint}`
    return { chat, line: project.file ? `${line}\n${agentsLine(agents.BUILT_IN_SPECIALISTS, project.file, project.specs)}` : line }
  } catch (error) {
    if (isMissing(error, '@kitana-sdk/adk')) {
      throw new CliError(`OBSERVE_AI=real needs GEMINI_API_KEY + GEMINI_MODEL, or Kitana: ${CHAT_INSTALL_HINT}`)
    }
    throw new CliError((error as Error).message)
  }
}

async function start(args: CliArgs, deps: CliDeps): Promise<{ collector: Collector; chatLine: string }> {
  const storage = new MemoryStorage()
  if (args.demo) await seedDemo(storage)
  const { chat, line: chatLine } = await loadChat(storage, args.root, deps)
  const detector = deps.env.OBSERVE_DETECTOR === 'off' ? undefined : new AnomalyDetector()
  const lines = [chatLine]
  if (detector) {
    const o = detector.options
    const action = chat ? 'agents investigate on their own' : 'anomalies are shown, no agents'
    lines.push(`  detector   errors > ${o.errorRate * 100}%, slow (>${o.slowMs}ms) > ${o.slowRate * 100}%, silence > ${o.noTrafficMs / 1000}s → ${action}`)
  } else lines.push('  detector   off (OBSERVE_DETECTOR=off)')
  if (args.demo) lines.push('  demo       "shop" scenario loaded: v1 → v2 regression, inventory errors, catalog N+1')
  const line = lines.join('\n')
  try {
    const collector = await startCollector({ port: args.port, host: args.host, apiKey: args.apiKey, storage, chat, detector })
    return { collector, chatLine: line }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new CliError(`port ${args.port} is already in use — is another nxo running? Use --port <n>`)
    }
    throw error
  }
}

function banner(collector: Collector, extra: string[] = []): string {
  return [
    'next-observe',
    `  ui         ${collector.url}`,
    `  collector  ${collector.url}  (OTLP: /v1/traces, API: /api/traces, /api/operations, /api/services)`,
    ...extra,
  ].join('\n')
}

async function runCollector(args: CliArgs, deps: CliDeps): Promise<number> {
  const { collector, chatLine } = await start(args, deps)
  deps.log(banner(collector, [chatLine, ...(args.apiKey ? ['  auth       x-api-key required'] : [])]))
  await deps.shutdownSignal
  await collector.close()
  return 0
}

async function runDev(args: CliArgs, deps: CliDeps): Promise<number> {
  const nextBin = resolveNextBin(args.root)
  const { collector, chatLine } = await start(args, deps)
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
  await collector.close()
  return code
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  try {
    const args = parseCliArgs(argv, deps.env, deps.cwd)
    if (args.command === 'help') {
      deps.log(HELP)
      return 0
    }
    return await (args.command === 'dev' ? runDev(args, deps) : runCollector(args, deps))
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    deps.log(`nxo: ${error.message}\n\n${HELP}`)
    return 1
  }
}
