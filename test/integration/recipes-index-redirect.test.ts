import { describe, it, expect, vi } from 'vitest'

/**
 * Fusão feed-home (#236, ADR-0020): o ÍNDICE do feed `/{locale}/recipes` FUNDE na home `/{locale}`
 * (a Descoberta é a home). A página antiga vira um `permanentRedirect('/{locale}')` (308). Provamos
 * que ela despacha o redirect PERMANENTE pro locale corrente — NÃO renderiza um feed à parte.
 *
 * O DETALHE `/{locale}/recipes/[id]` NÃO é tocado (rota irmã) — coberto por `recipe-metadata`/
 * `recipe-public-by-slug`. Aqui só o índice.
 *
 * Mockamos `next/navigation` (permanentRedirect lança pra abortar o render, como o Next faz) — a
 * sentinela carrega o destino, asserível.
 */

class PermanentRedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_PERMANENT_REDIRECT:${to}`)
  }
}
vi.mock('next/navigation', () => ({
  permanentRedirect: (to: string) => {
    throw new PermanentRedirectError(to)
  },
}))

import RecipesIndex from '@/app/[locale]/recipes/page'

async function run(locale: string): Promise<{ to: string }> {
  try {
    await RecipesIndex({ params: Promise.resolve({ locale }) })
  } catch (e) {
    if (e instanceof PermanentRedirectError) return { to: e.to }
    throw e
  }
  throw new Error('esperava um permanentRedirect, mas a página não redirecionou')
}

describe('/{locale}/recipes (índice) → permanentRedirect pra home /{locale} (#236)', () => {
  it('pt-BR ⇒ permanentRedirect("/pt-BR")', async () => {
    const { to } = await run('pt-BR')
    expect(to).toBe('/pt-BR')
  })

  it('en-US ⇒ permanentRedirect("/en-US")', async () => {
    const { to } = await run('en-US')
    expect(to).toBe('/en-US')
  })
})
