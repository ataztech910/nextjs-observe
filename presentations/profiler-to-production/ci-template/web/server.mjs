// The streaming catalog from investigation 01: the catalog arrives first, recommendations 3 s later.
// SCRIPT=module reproduces the bug (the entry waits for the whole document); SCRIPT=async is the fix.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import ts from 'typescript'
import { build } from 'vite'

const script = process.env.SCRIPT === 'module' ? 'module' : 'async'
const port = Number(process.env.PORT ?? 4361)
const source = await readFile(new URL('./Catalog.tsx', import.meta.url), 'utf8')
const mod = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText)(
  (name) => (name === 'react' ? React : null), mod, mod.exports)
const { Catalog } = mod.exports
const built = await build({ configFile: false, logLevel: 'error', build: { write: false, rollupOptions: { input: fileURLToPath(new URL('./client.tsx', import.meta.url)) } } })
const client = built.output.find((item) => item.type === 'chunk' && item.isEntry).code

createServer((req, res) => {
  if (req.url === '/client.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(client) }
  let ready = false, release
  const pending = new Promise((resolve) => { release = resolve })
  function Recommendations() { if (!ready) throw pending; return React.createElement('section', { id: 'recommendations' }, 'Recommendations ready') }
  const timer = setTimeout(() => { ready = true; release() }, 3000)
  const stream = renderToPipeableStream(React.createElement('html', { 'data-script': script },
    React.createElement('head', null, React.createElement('title', null, 'Streaming catalog'),
      React.createElement('script', { type: 'module', src: '/client.js', async: script === 'async' })),
    React.createElement('body', null, React.createElement(Catalog),
      React.createElement(React.Suspense, { fallback: React.createElement('p', { id: 'fallback' }, 'Loading recommendations') }, React.createElement(Recommendations)))), {
    onError() {}, // an aborted late part is expected when the test closes the page
    onShellReady() { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); stream.pipe(res) },
  })
  res.on('close', () => { clearTimeout(timer); stream.abort() }) // the test closed the page before the late part — fine
}).listen(port, '127.0.0.1', () => console.log(`catalog (${script}) on http://127.0.0.1:${port}/`))
