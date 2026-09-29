import { transformAsync } from '@babel/core'
import observePlugin from './plugin.js'

export const RUNTIME_SPECIFIER = 'next-observe/runtime'
export const DIRECTIVE_PATTERN = /['"]use observe['"]/

export interface TransformInput {
  source: string
  filename: string
  /** Project root — file paths in span attributes are relative to it. */
  cwd: string
  inputSourceMap?: object
  runtime?: string
}

export interface TransformOutput {
  code: string
  map: object | null
}

function parserPlugins(filename: string): ('typescript' | 'jsx')[] {
  if (/\.[cm]?tsx$/.test(filename)) return ['typescript', 'jsx']
  if (/\.[cm]?ts$/.test(filename)) return ['typescript']
  return ['jsx']
}

// Babel is used only as a library here — no babel config is created, so Next keeps SWC.
export async function transformObserve(input: TransformInput): Promise<TransformOutput> {
  if (!DIRECTIVE_PATTERN.test(input.source)) return { code: input.source, map: null }
  const result = await transformAsync(input.source, {
    filename: input.filename,
    cwd: input.cwd,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    inputSourceMap: input.inputSourceMap as never,
    parserOpts: { plugins: parserPlugins(input.filename) },
    plugins: [[observePlugin, { runtime: input.runtime ?? RUNTIME_SPECIFIER }]],
  })
  if (!result?.code) throw new Error(`[next-observe] transform produced no output for ${input.filename}`)
  return { code: result.code, map: (result.map as object | null) ?? null }
}
