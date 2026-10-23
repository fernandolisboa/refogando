import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Toda rota de API do Console exige papel no servidor. O gate das páginas (`admin/layout.tsx` + `SectionGate`)
 * protege a tela; o dado sai pelas rotas abaixo, então cada handler exportado chama `requireRole` (401 sem
 * sessão, 403 com papel insuficiente). `/api/admin/*` pede 'admin'; `/api/curate/*` pede 'curador' (ou mais).
 * Rota nova sem a guarda reprova aqui. Leitura do código-fonte, sem subir o app: os handlers são
 * `export async function GET|POST|…`; outra forma de exportar reprova para o teste não deixar passar nada.
 */
const API = path.join(process.cwd(), 'src', 'app', 'api')
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS'

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return routeFiles(full)
    return e.name === 'route.ts' ? [full] : []
  })
}

/** Corpo de cada handler: do `export … function METHOD` até o próximo handler exportado (ou o fim). */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS})\\b`, 'g')
  const starts = [...src.matchAll(re)]
  return starts.map((m, i) => ({
    method: m[1],
    body: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }))
}

const AREAS = [
  { dir: 'admin', roles: ['admin'] },
  { dir: 'curate', roles: ['curador', 'admin'] },
] as const

describe('rotas de API do Console exigem papel', () => {
  for (const area of AREAS) {
    const files = routeFiles(path.join(API, area.dir))

    it(`/api/${area.dir}: há rotas para conferir`, () => {
      expect(files.length).toBeGreaterThan(0)
    })

    for (const file of files) {
      const rel = path.relative(process.cwd(), file)
      const src = readFileSync(file, 'utf8')

      it(`${rel}: handlers só como \`export function\``, () => {
        const other = new RegExp(`export\\s+(?:const|let|var)\\s+(${METHODS})\\b|export\\s*\\{[^}]*\\b(${METHODS})\\b`)
        expect(src).not.toMatch(other)
        expect(handlers(src).length).toBeGreaterThan(0)
      })

      for (const { method, body } of handlers(src)) {
        it(`${rel} ${method}: requireRole com ${area.roles.join(' ou ')}`, () => {
          const call = body.match(/requireRole\(\s*\w+\s*,\s*'(\w+)'\s*\)/)
          expect(call, 'handler sem requireRole').not.toBeNull()
          expect(area.roles).toContain(call?.[1])
          // A guarda vem antes de qualquer leitura de banco ou corpo.
          const guardAt = body.indexOf('requireRole(')
          for (const early of ['getDb(', '.json()', 'await db']) {
            const at = body.indexOf(early)
            if (at !== -1) expect(at, `${early} antes da guarda`).toBeGreaterThan(guardAt)
          }
        })
      }
    }
  }
})
