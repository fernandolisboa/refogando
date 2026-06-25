import { describe, it, expect } from 'vitest'
import { bareHost, sourceNameIsHost } from '@/domain/source-host'

/**
 * Normalização de host da atribuição (#272/#169, ADR-0019) — PURO. Fonte ÚNICA usada pelo gate do
 * servidor (clear-attribution) E pelo predicado do botão no cliente, p/ os dois decidirem "há um nome
 * humano a remover?" do mesmo jeito (o nit do plan-review: as duas pontas não podem divergir).
 */

describe('bareHost (#272)', () => {
  it('host pelado: lowercase, sem www. e sem ponto final', () => {
    expect(bareHost('https://www.Exemplo.com/x')).toBe('exemplo.com')
    expect(bareHost('https://EXEMPLO.com.')).toBe('exemplo.com')
    expect(bareHost('https://m.exemplo.com/x')).toBe('m.exemplo.com') // só `www.` é removido
  })

  it('URL inválida / vazia / nula → null', () => {
    expect(bareHost('não é url')).toBeNull()
    expect(bareHost('')).toBeNull()
    expect(bareHost(null)).toBeNull()
    expect(bareHost(undefined)).toBeNull()
  })
})

describe('sourceNameIsHost (#272) — "há um nome humano a remover?"', () => {
  it('sem nome → true (nada a remover)', () => {
    expect(sourceNameIsHost(null, 'https://x.com')).toBe(true)
    expect(sourceNameIsHost('', 'https://x.com')).toBe(true)
  })

  it('nome == host (normalizado) → true (é só o host, nada humano)', () => {
    expect(sourceNameIsHost('exemplo.com', 'https://exemplo.com/x')).toBe(true)
    expect(sourceNameIsHost('WWW.Exemplo.com.', 'https://www.exemplo.com/x')).toBe(true) // www/case/ponto
    expect(sourceNameIsHost('exemplo.com', 'https://www.exemplo.com/x')).toBe(true) // host pelado = exemplo.com
  })

  it('nome humano ≠ host → false (HÁ nome a remover)', () => {
    expect(sourceNameIsHost('Cozinha da Vovó', 'https://exemplo.com/x')).toBe(false)
    expect(sourceNameIsHost('TudoGostoso', 'https://tudogostoso.com.br/r')).toBe(false)
  })

  it('com nome mas sem URL derivável → false (há nome real)', () => {
    expect(sourceNameIsHost('Cozinha da Vovó', null)).toBe(false)
    expect(sourceNameIsHost('Algo', 'não é url')).toBe(false)
  })
})
