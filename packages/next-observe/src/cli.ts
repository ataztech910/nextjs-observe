// `nxo` / `next-observe` CLI. Pure logic lives here; bin.ts wires real process I/O.
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { MemoryStorage, startCollector, type Collector, type CollectorOptions } from './collector/index.js'

// Type-only: the agents module (and @google/adk behind it) is loaded lazily, it's an optional peer dependency.
type AgentsModule = typeof import('./agents/index.js')

export const HELP = `Usage:
  nxo dev [--root <dir>] [--port <n>] [-- <next dev args>]
      Start the collector and \`next dev\` for the app in <dir> (default: current directory).
      Example: nxo dev --root apps/web -- -p 3100

  nxo collector [--host <host>] [--port <n>] [--api-key <key>]
      Start only the collector (e.g. on a server). Reads OBSERVE_HOST, OBSERVE_PORT, OBSERVE_API_KEY.

Environment: OBSERVE_ROOT, OBSERVE_PORT (default 4318), OBSERVE_HOST (default 127.0.0.1), OBSERVE_API_KEY`

export class CliError extends Error {}

export type Env = Record<string, string | undefined>

export interface CliArgs {
  command: 'dev' | 'collector' | 'help'
  root: string
  port: number
  host: string
  apiKey?: string
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

// Chat needs the optional @google/adk; without it the collector still runs, chat is just off.
async function loadChat(storage: MemoryStorage, deps: CliDeps): Promise<{ chat?: CollectorOptions['chat']; line: string }> {
  let agents: AgentsModule
  try {
    agents = await (deps.loadAgents ?? (() => import('./agents/index.js')))()
  } catch (error) {
    if (isMissing(error, '@google/adk')) return { line: `  chat       disabled — ${CHAT_INSTALL_HINT}` }
    throw error
  }
  try {
    const chat = await agents.createChatHandler({ storage, env: deps.env })
    const hint = chat.mode === 'mock' ? '  (OBSERVE_AI=real for a real model)' : ''
    return { chat, line: `  chat       ${chat.mode}${hint}` }
  } catch (error) {
    if (isMissing(error, '@kitana-sdk/adk')) {
      throw new CliError(`OBSERVE_AI=real needs GEMINI_API_KEY + GEMINI_MODEL, or Kitana: ${CHAT_INSTALL_HINT}`)
    }
    throw new CliError((error as Error).message)
  }
}

async function start(args: CliArgs, deps: CliDeps): Promise<{ collector: Collector; chatLine: string }> {
  const storage = new MemoryStorage()
  const { chat, line } = await loadChat(storage, deps)
  try {
    const collector = await startCollector({ port: args.port, host: args.host, apiKey: args.apiKey, storage, chat })
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
