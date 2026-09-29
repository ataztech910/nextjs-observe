import { parseSync } from '@babel/core'
import { describe, expect, it } from 'vitest'
import { transformObserve } from '../src/transform/index.js'

const cwd = '/project'

async function transform(source: string, file = 'app/page.tsx') {
  const { code } = await transformObserve({ source, filename: `${cwd}/${file}`, cwd })
  // Output must stay valid TS/JSX — Next parses it right after us.
  parseSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: file.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'] },
  })
  return code
}

const wrapped = (name: string, kind = 'function', file = 'app/page.tsx') =>
  `__observe.run("${name}", "${kind}", "${file}"`

describe('files without the directive', () => {
  it('are returned untouched', async () => {
    const source = `export function a() { return 1 }`
    expect(await transformObserve({ source, filename: `${cwd}/a.ts`, cwd })).toEqual({ code: source, map: null })
  })
})

describe("file-level 'use observe'", () => {
  it('wraps every exported function and nothing else', async () => {
    const code = await transform(`'use observe'
export async function load() { return 1 }
export const arrow = async () => 2
function helper() { return 3 }
function laterExported() { return 4 }
export { laterExported }
export default async function Page() {
  const nested = () => 5
  return nested()
}`)
    expect(code).toContain(wrapped('load'))
    expect(code).toContain(wrapped('arrow'))
    expect(code).toContain(wrapped('laterExported'))
    expect(code).toContain(wrapped('Page', 'component'))
    expect(code).not.toContain(wrapped('helper'))
    expect(code).not.toContain(wrapped('nested'))
    expect(code).not.toContain('use observe')
    expect(code.startsWith('import { __observe } from "next-observe/runtime";')).toBe(true)
  })

  it('keeps async-ness of the wrapped body', async () => {
    const code = await transform(`'use observe'\nexport async function load() { await x() }`, 'lib.ts')
    expect(code).toContain(`${wrapped('load', 'function', 'lib.ts')}, async () => {`)
  })

  it('converts expression-bodied arrows', async () => {
    const code = await transform(`'use observe'\nexport const double = (n: number) => n * 2`, 'lib.ts')
    expect(code).toMatch(/double = \(n: number\) => \{\s+return __observe\.run\("double", "function", "lib\.ts", \(\) => \{\s+return n \* 2;/)
  })

  it('names an anonymous default export "default" without displayName', async () => {
    const code = await transform(`'use client'\n'use observe'\nexport default () => <div />`)
    expect(code).toContain(wrapped('default'))
    expect(code).not.toContain('displayName')
  })

  it('skips generators', async () => {
    const code = await transform(`'use observe'\nexport function* ids() { yield 1 }`, 'lib.ts')
    expect(code).not.toContain('__observe')
  })
})

describe("function-level 'use observe'", () => {
  it('wraps only the marked function and removes the directive', async () => {
    const code = await transform(
      `export async function marked() {\n  'use observe'\n  return 1\n}\nexport function plain() { return 2 }`,
      'lib.ts',
    )
    expect(code).toContain(wrapped('marked', 'function', 'lib.ts'))
    expect(code).not.toContain(wrapped('plain', 'function', 'lib.ts'))
    expect(code).not.toContain('use observe')
  })

  it("keeps an inline 'use server' on the outer function body", async () => {
    const code = await transform(`export async function save() {\n  'use server'\n  'use observe'\n  return 1\n}`, 'lib.ts')
    expect(code).toMatch(/async function save\(\) \{\s+'use server';\s+return __observe\.run/)
  })
})

describe('coexistence with Next directives', () => {
  it("keeps 'use client' first and adds displayName to components only", async () => {
    const code = await transform(`'use client'
'use observe'
export default function Counter() { return <button /> }
export const Badge = () => <span />
export const format = (n: number) => String(n)`)
    expect(code.startsWith("'use client';")).toBe(true)
    expect(code).toContain('Counter.displayName = "Counter"')
    expect(code).toContain('Badge.displayName = "Badge"')
    expect(code).not.toContain('format.displayName')
    expect(code).toContain(wrapped('format'))
  })

  it("keeps 'use server' first, functions async, no displayName", async () => {
    const code = await transform(`'use server'\n'use observe'\nexport async function Increment() { return 1 }`, 'actions.ts')
    expect(code.startsWith("'use server';")).toBe(true)
    expect(code).toContain('export async function Increment()')
    expect(code).not.toContain('displayName')
  })
})

describe('span attributes', () => {
  it('uses the file path relative to the project root', async () => {
    const code = await transform(`'use observe'\nexport function a() {}`, 'app/deep/nested/lib.ts')
    expect(code).toContain('"app/deep/nested/lib.ts"')
    expect(code).not.toContain(cwd)
  })
})
