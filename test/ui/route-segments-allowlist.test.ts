/**
 * Allowlist de segmentos da rota do cliente (#590, ADR-0048). `CLIENT_ROUTE_TREE` é escrita à mão em
 * `src/domain/error-report.ts`; este teste varre `src/app/[locale]` e exige a MESMA árvore, nos dois
 * sentidos: página nova sem entrada lá reprova aqui (senão a rota dela sairia como `[param]` no log), e
 * entrada sem página também (allowlist só do que existe).
 *
 * Regras da varredura, iguais às do App Router: grupo `(…)` não vira segmento (os filhos sobem para o pai),
 * pasta privada `_…` e slot `@…` não são rota, `[x]`/`[...x]` é o filho dinâmico `*`.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENT_ROUTE_TREE } from '@/domain/error-report'

type Tree = { [segment: string]: Tree }

function merge(into: Tree, from: Tree): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] ??= {}
    merge(into[k], v)
  }
}

function scan(dir: string): Tree {
  const tree: Tree = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith('_') || name.startsWith('@')) continue
    const child = scan(join(dir, name))
    if (name.startsWith('(') && name.endsWith(')')) merge(tree, child)
    else if (name.startsWith('[')) merge((tree['*'] ??= {}), child)
    else merge((tree[name] ??= {}), child)
  }
  return tree
}

describe('CLIENT_ROUTE_TREE', () => {
  it('é exatamente a árvore de segmentos de src/app/[locale]', () => {
    const fromDisk = scan(join(process.cwd(), 'src', 'app', '[locale]'))
    expect(CLIENT_ROUTE_TREE).toEqual(fromDisk)
  })
})
