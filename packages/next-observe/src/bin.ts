#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { run } from './cli.js'

const shutdownSignal = new Promise<string>((resolve) => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => resolve(signal))
})

run(process.argv.slice(2), { env: process.env, cwd: process.cwd(), log: (line) => console.log(line), spawn, shutdownSignal }).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
