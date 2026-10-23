import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * As rotas de `/api/admin` e `/api/curate` exigem papel no servidor. O gate das páginas (`admin/layout.tsx` +
 * `SectionGate`) protege a tela; o dado sai pelas rotas, então cada handler exportado chama `requireRole` (401
 * sem sessão, 403 com papel insuficiente) e devolve a resposta dele se falhar. As poucas rotas de fora usadas
 * pelo Console (ex.: `PATCH /api/recipes/[id]/translations/[locale]`) têm a guarda própria e testes de
 * integração; não entram aqui. `/api/admin/*` pede 'admin'; `/api/curate/*` pede 'curador' (ou mais).
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

/**
 * Corpo de cada handler: do `export … function METHOD` até o `}` na coluna 0 que fecha a função (o estilo
 * do repo), para um `requireRole` num helper abaixo não contar pelo último handler.
 */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS})\\b`, 'g')
  return [...src.matchAll(re)].map((m) => {
    const end = src.indexOf('\n}', m.index)
    return { method: m[1], body: src.slice(m.index, end === -1 ? undefined : end) }
  })
}

// `const g = await requireRole(req, '<papel>')` seguido de `if (!g.ok) return g.response`: o resultado é
// conferido, não só chamado.
const GUARD = /const (\w+) = await requireRole\(\s*\w+\s*,\s*'(\w+)'\s*\)\s*\n\s*if \(!\1\.ok\) return \1\.response\b/

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
        it(`${rel} ${method}: requireRole com ${area.roles.join(' ou ')}, conferido antes de tudo`, () => {
          const guard = body.match(GUARD)
          expect(guard, 'handler sem `const g = await requireRole(…)` + `if (!g.ok) return g.response`').not.toBeNull()
          expect(area.roles).toContain(guard?.[2])
          // Antes da guarda, só ler os params da rota (o id da URL): nenhum outro await (banco, corpo, helper).
          const before = body.slice(0, guard?.index ?? 0)
          expect(before.replace(/await params\b/g, ''), 'await antes da guarda').not.toMatch(/\bawait\b/)
        })
      }
    }
  }
})
