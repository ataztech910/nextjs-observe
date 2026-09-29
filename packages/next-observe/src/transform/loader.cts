// Turbopack/webpack loader. CommonJS on purpose: loader-runner requires loaders; the ESM transform is imported dynamically.

interface LoaderContext {
  resourcePath: string
  rootContext?: string
  async(): (error: Error | null, code?: string, map?: object) => void
}

function observeLoader(this: LoaderContext, source: string, inputMap?: object): void {
  const callback = this.async()
  const filename = this.resourcePath
  const cwd = this.rootContext || process.cwd()

  import('./index.js')
    .then(({ transformObserve }) => transformObserve({ source, filename, cwd, inputSourceMap: inputMap }))
    .then(({ code, map }) => {
      if (process.env.OBSERVE_DEBUG) console.log(`[next-observe] ${filename}\n${code}\n`)
      callback(null, code, map ?? undefined)
    })
    .catch((error: Error) => callback(error))
}

export = observeLoader
