// Babel plugin for the 'use observe' directive.
// 'use observe' at file level  → every exported function in the file is wrapped.
// 'use observe' in a function  → only that function is wrapped.
// Wrapping moves the original body into an arrow passed to __observe.run(), so `this`,
// `arguments`, hoisting, the function name and other directives ('use server') stay intact.
import type { NodePath, PluginAPI, PluginObject, PluginPass, types as BabelTypes } from '@babel/core'

export const DIRECTIVE = 'use observe'

export interface ObservePluginOptions {
  /** Module specifier the injected `__observe` import points to. */
  runtime: string
}

type Kind = 'component' | 'function'

export default function observePlugin(api: PluginAPI, rawOptions: object): PluginObject<PluginPass> {
  const t = api.types
  const options = rawOptions as ObservePluginOptions
  const wrappedBodies = new WeakSet<BabelTypes.Node>()

  function takeDirective(directives: BabelTypes.Directive[] | undefined): boolean {
    const i = directives ? directives.findIndex((d) => d.value.value === DIRECTIVE) : -1
    if (i === -1) return false
    directives!.splice(i, 1)
    return true
  }

  function exportedNames(program: BabelTypes.Program): Set<string> {
    const names = new Set<string>()
    for (const node of program.body) {
      if (t.isExportNamedDeclaration(node) && !node.declaration) {
        for (const s of node.specifiers) if (t.isExportSpecifier(s) && t.isIdentifier(s.local)) names.add(s.local.name)
      }
      if (t.isExportDefaultDeclaration(node) && t.isIdentifier(node.declaration)) {
        names.add(node.declaration.name)
      }
    }
    return names
  }

  // Name of the function and the top-level statement that owns it (null when nested/anonymous).
  function describe(fp: NodePath<BabelTypes.Function>): { name: string; statement: NodePath | null } {
    const { node, parentPath } = fp
    if (t.isFunctionDeclaration(node) && node.id) {
      return { name: node.id.name, statement: parentPath?.isProgram() ? fp : parentPath }
    }
    if (parentPath?.isExportDefaultDeclaration()) {
      return { name: 'default', statement: parentPath }
    }
    if (parentPath?.isVariableDeclarator() && t.isIdentifier(parentPath.node.id)) {
      const decl = parentPath.parentPath!
      const statement = decl.parentPath?.isExportNamedDeclaration() ? decl.parentPath : decl
      return { name: parentPath.node.id.name, statement }
    }
    return { name: 'anonymous', statement: null }
  }

  function isExportedTopLevel(statement: NodePath | null, name: string, names: Set<string>): boolean {
    if (!statement?.parentPath?.isProgram()) return false
    return statement.isExportNamedDeclaration() || statement.isExportDefaultDeclaration() || names.has(name)
  }

  function wrap(fp: NodePath<BabelTypes.Function>, name: string, kind: Kind, file: string) {
    const { node } = fp
    const body = t.isBlockStatement(node.body) ? node.body : t.blockStatement([t.returnStatement(node.body)])
    const keptDirectives = body.directives ?? []
    body.directives = []
    const inner = t.arrowFunctionExpression([], body, node.async)
    wrappedBodies.add(inner)
    node.body = t.blockStatement(
      [
        t.returnStatement(
          t.callExpression(t.memberExpression(t.identifier('__observe'), t.identifier('run')), [
            t.stringLiteral(name),
            t.stringLiteral(kind),
            t.stringLiteral(file),
            inner,
          ]),
        ),
      ],
      keptDirectives,
    )
    if (t.isArrowFunctionExpression(node)) node.expression = false
  }

  return {
    name: 'next-observe',
    visitor: {
      Program(programPath, state) {
        const program = programPath.node
        const fileLevel = takeDirective(program.directives)
        const isServerActions = program.directives.some((d) => d.value.value === 'use server')
        const file = state.filename ? state.filename.replace(state.cwd + '/', '') : 'unknown'
        const names = exportedNames(program)
        const displayNames: { statement: NodePath; name: string }[] = []
        let used = false

        programPath.traverse({
          Function(fp) {
            if (wrappedBodies.has(fp.node) || fp.node.generator) return
            const own = t.isBlockStatement(fp.node.body) && takeDirective(fp.node.body.directives)
            const { name, statement } = describe(fp)
            if (!own && !(fileLevel && isExportedTopLevel(statement, name, names))) return

            const kind: Kind = /^[A-Z]/.test(name) ? 'component' : 'function'
            wrap(fp, name, kind, file)
            used = true
            // Minifiers mangle function names; displayName survives and names the component in the profiler.
            if (kind === 'component' && !isServerActions && statement?.parentPath?.isProgram()) {
              displayNames.push({ statement, name })
            }
          },
        })

        for (const { statement, name } of displayNames) {
          statement.insertAfter(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.identifier(name), t.identifier('displayName')),
                t.stringLiteral(name),
              ),
            ),
          )
        }

        if (used) {
          programPath.unshiftContainer(
            'body',
            t.importDeclaration(
              [t.importSpecifier(t.identifier('__observe'), t.identifier('__observe'))],
              t.stringLiteral(options.runtime),
            ),
          )
        }
      },
    },
  }
}
