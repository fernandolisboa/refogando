import { describe, it, expect, vi, afterEach } from 'vitest'
import { logDescartes } from '@/server/claude/client'

/**
 * Log dos valores que caíram no fallback do vocabulário (ADR-0009, adendo): só campo e tamanho.
 * O valor é conteúdo de receita gerado pela IA, e a Política (item 3.7) diz que nossas linhas não o trazem.
 */
afterEach(() => vi.restoreAllMocks())

describe('logDescartes', () => {
  it('loga o campo e o tamanho, nunca o valor — nem o curto com cara de rótulo', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logDescartes('generateRecipe', [
      { campo: 'unidade', valor: 'maço' },
      { campo: 'cozinha', valor: 'Marciana' },
      { campo: 'restricoes', valor: 'sem nada que a Maria não come' },
    ])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('[claude/generateRecipe] valores fora do vocabulário caíram no fallback:', {
      total: 3,
      descartes: [
        { campo: 'unidade', tamanho: 4 },
        { campo: 'cozinha', tamanho: 8 },
        { campo: 'restricoes', tamanho: 29 },
      ],
    })
    const linha = JSON.stringify(spy.mock.calls)
    for (const v of ['maço', 'Marciana', 'Maria']) expect(linha).not.toContain(v)
  })

  it('sem descartes, não loga', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logDescartes('generateRecipe', [])
    expect(spy).not.toHaveBeenCalled()
  })
})
