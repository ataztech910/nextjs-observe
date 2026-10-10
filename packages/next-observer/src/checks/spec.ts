// Scheduled checks: the app's observe.checks.ts lists requests the observer sends on a timer and what a good answer
// looks like — is the app up, is it fast enough, does it still refuse what it must refuse. Plain data, no functions and
// no imports: the file is read by the observer, never by the app.

export interface CheckExpect {
  /** The status (or any of several) that counts as good. Default: any 2xx. */
  status?: number | number[]
  /** The whole answer, body included, must arrive within this many ms. */
  maxMs?: number
  /** Text the body must contain. */
  bodyIncludes?: string
}

export interface CheckSpec {
  /** Shown in the UI and in anomalies; unique in the file. */
  name: string
  /** A path ("/api/products") — sent to the app — or a full http(s) URL. */
  url: string
  /** Default GET. */
  method?: string
  headers?: Record<string, string>
  /** A string is sent as is; anything else as JSON. */
  body?: unknown
  /** Default 60, at least 5. */
  everySeconds?: number
  /** Default 10 000. */
  timeoutMs?: number
  expect?: CheckExpect
}

/** A validated check with the defaults filled in. */
export interface Check {
  name: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  everyMs: number
  timeoutMs: number
  expect: { status?: number[]; maxMs?: number; bodyIncludes?: string }
}

export const CHECK_DEFAULTS = { everySeconds: 60, timeoutMs: 10_000 }
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const KEYS = ['name', 'url', 'method', 'headers', 'body', 'everySeconds', 'timeoutMs', 'expect']
const EXPECT_KEYS = ['status', 'maxMs', 'bodyIncludes']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A key nobody reads is a silent typo ("expects", "maxMS") — the check would pass forever. */
function unknownKey(value: Record<string, unknown>, known: string[]): string | undefined {
  return Object.keys(value).find((key) => !known.includes(key))
}

function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Throws with a message that names the check and the field. */
export function validateCheck(raw: unknown): Check {
  if (!isRecord(raw)) throw new Error('a check must be an object like { name, url, expect }')
  const name = raw.name
  if (typeof name !== 'string' || name.trim() === '' || name.length > 80) throw new Error('a check needs a `name` (1–80 characters)')
  const fail = (message: string): never => {
    throw new Error(`check "${name}": ${message}`)
  }
  const stray = unknownKey(raw, KEYS)
  if (stray) fail(`unknown field \`${stray}\` (known: ${KEYS.join(', ')})`)

  const url = raw.url
  if (typeof url !== 'string' || !(url.startsWith('/') || /^https?:\/\//i.test(url))) fail('`url` must be a path starting with "/" or a full http(s) URL')
  if (typeof url === 'string' && !url.startsWith('/') && !URL.canParse(url)) fail(`\`url\` is not a valid URL: ${url}`)

  const method = raw.method === undefined ? 'GET' : typeof raw.method === 'string' ? raw.method.toUpperCase() : ''
  if (!METHODS.includes(method)) fail(`\`method\` must be one of ${METHODS.join(', ')}`)

  const headers: Record<string, string> = {}
  if (raw.headers !== undefined) {
    if (!isRecord(raw.headers)) fail('`headers` must be an object of strings')
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      if (typeof value !== 'string') fail(`header \`${key}\` must be a string`)
      headers[key.toLowerCase()] = value as string
    }
  }

  let body: string | undefined
  if (raw.body !== undefined) {
    if (method === 'GET' || method === 'HEAD') fail(`a ${method} request cannot have a \`body\``)
    if (typeof raw.body === 'string') body = raw.body
    else {
      // A function or a symbol gives undefined, a BigInt or a cycle throws — neither is a body anyone meant to send.
      try {
        body = JSON.stringify(raw.body)
      } catch {
        body = undefined
      }
      if (body === undefined) fail('`body` cannot be sent as JSON — use plain data or a string')
      headers['content-type'] ??= 'application/json'
    }
  }

  const everySeconds = raw.everySeconds ?? CHECK_DEFAULTS.everySeconds
  if (!numberIn(everySeconds, 5, 86_400)) fail('`everySeconds` must be a number from 5 to 86400')
  const timeoutMs = raw.timeoutMs ?? CHECK_DEFAULTS.timeoutMs
  if (!numberIn(timeoutMs, 100, 120_000)) fail('`timeoutMs` must be a number from 100 to 120000')

  const expect: Check['expect'] = {}
  if (raw.expect !== undefined) {
    const e = raw.expect
    if (!isRecord(e)) return fail('`expect` must be an object like { status: 200, maxMs: 500 }')
    const strayExpect = unknownKey(e, EXPECT_KEYS)
    if (strayExpect) fail(`unknown field \`expect.${strayExpect}\` (known: ${EXPECT_KEYS.join(', ')})`)
    if (e.status !== undefined) {
      const list = Array.isArray(e.status) ? e.status : [e.status]
      if (list.length === 0 || !list.every((s) => Number.isInteger(s) && numberIn(s, 100, 599))) fail('`expect.status` must be a status code (100–599) or a list of them')
      expect.status = list as number[]
    }
    if (e.maxMs !== undefined) {
      if (!numberIn(e.maxMs, 1, 120_000)) fail('`expect.maxMs` must be a number from 1 to 120000')
      expect.maxMs = e.maxMs as number
    }
    if (e.bodyIncludes !== undefined) {
      if (typeof e.bodyIncludes !== 'string' || e.bodyIncludes === '') fail('`expect.bodyIncludes` must be a non-empty string')
      // An answer without a body can never contain it: the check would fail forever.
      if (method === 'HEAD') fail('`expect.bodyIncludes` cannot be used with HEAD — the answer has no body')
      if (expect.status?.every((s) => s === 204 || s === 304)) fail(`\`expect.bodyIncludes\` cannot be used with status ${expect.status.join(' or ')} — the answer has no body`)
      expect.bodyIncludes = e.bodyIncludes as string
    }
  }

  return { name, url: url as string, method, headers, ...(body === undefined ? {} : { body }), everyMs: (everySeconds as number) * 1000, timeoutMs: timeoutMs as number, expect }
}

/** Validates the whole file's export; names must be unique — results are kept by name. */
export function validateChecks(exported: unknown): Check[] {
  if (!Array.isArray(exported)) throw new Error('export default an array of checks: [{ name, url, expect }]')
  const checks = exported.map(validateCheck)
  const names = checks.map((c) => c.name)
  const duplicate = names.find((name, i) => names.indexOf(name) !== i)
  if (duplicate) throw new Error(`check "${duplicate}" is defined twice`)
  return checks
}
