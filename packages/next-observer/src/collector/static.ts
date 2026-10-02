// Serves the built UI (dist/ui) with SPA fallback: unknown paths get index.html so deep links like /traces/<id> work.
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile(), () => false)
}

/** Returns false when there is no UI build, so the caller can answer 404. */
export async function serveUi(uiDir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const root = resolve(uiDir)
  const index = join(root, 'index.html')
  if (!(await isFile(index))) return false

  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    decoded = '/'
  }
  const candidate = resolve(root, `.${decoded}`)
  // Anything resolving outside the UI dir (../ tricks) falls back to index.html instead of being read.
  const inside = candidate === root || candidate.startsWith(root + sep)
  const file = inside && (await isFile(candidate)) ? candidate : index

  const hashedAsset = file.startsWith(join(root, 'assets') + sep)
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(await readFile(file))
  return true
}
