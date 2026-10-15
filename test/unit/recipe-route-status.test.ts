import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda estrutural do status HTTP das rotas fora do grupo (receita: ADR-0020 decisão 4; perfil:
 * handoff 72). Um `loading.tsx` abre um Suspense que manda o HTML com 200 antes de a página decidir o
 * desfecho; abaixo dele, o `permanentRedirect` do link antigo e o `notFound()` viram 308/404 só no
 * payload (redirect no cliente, soft 404). Por isso o esqueleto mora no grupo `(com-carregamento)`, e
 * `recipes/` e `u/` ficam fora. O status em si é verificado num build de produção (`next start`); aqui
 * só se trava a estrutura que o produz.
 */
const APP = path.join(process.cwd(), 'src', 'app')
const LOCALE = path.join(APP, '[locale]')

describe('rotas da receita e do perfil fora de qualquer loading.tsx', () => {
  it('nenhum ancestral de recipes/[id] e u/[handle] (nem as próprias rotas) tem loading.tsx', () => {
    const dirs = [
      APP,
      LOCALE,
      path.join(LOCALE, 'recipes'),
      path.join(LOCALE, 'recipes', '[id]'),
      path.join(LOCALE, 'u'),
      path.join(LOCALE, 'u', '[handle]'),
    ]
    for (const dir of dirs) {
      expect(existsSync(dir), dir).toBe(true)
      const loading = readdirSync(dir).filter((f) => /^loading\.(tsx|ts|jsx|js)$/.test(f))
      expect(loading, dir).toEqual([])
    }
  })

  it('o layout de [locale] não tem <Suspense> (um Suspense ali também mandaria o 200 antes)', () => {
    const layout = readFileSync(path.join(LOCALE, 'layout.tsx'), 'utf8')
    expect(layout).not.toMatch(/<Suspense\b/)
  })

  it('o esqueleto continua no grupo (com-carregamento), que não contém recipes/ nem u/', () => {
    const group = path.join(LOCALE, '(com-carregamento)')
    expect(existsSync(path.join(group, 'loading.tsx'))).toBe(true)
    expect(existsSync(path.join(group, 'recipes'))).toBe(false)
    expect(existsSync(path.join(group, 'u'))).toBe(false)
  })
})
