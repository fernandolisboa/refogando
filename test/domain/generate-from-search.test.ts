import { describe, it, expect } from 'vitest'
import {
  GENERATE_FROM_SEARCH_MIN_LETTERS,
  createFromSearchHref,
  searchTermReadiness,
} from '@/domain/generate-from-search'

describe('searchTermReadiness', () => {
  it('sem letras ⇒ none (vazio, espaços, só números/pontuação)', () => {
    expect(searchTermReadiness('')).toBe('none')
    expect(searchTermReadiness('   ')).toBe('none')
    expect(searchTermReadiness('123 !?')).toBe('none')
  })

  it(`menos de ${GENERATE_FROM_SEARCH_MIN_LETTERS} letras ⇒ too_short`, () => {
    expect(searchTermReadiness('fr')).toBe('too_short')
    // Números não contam como letras.
    expect(searchTermReadiness('fr 22')).toBe('too_short')
  })

  it(`${GENERATE_FROM_SEARCH_MIN_LETTERS}+ letras ⇒ ok (acentos contam como letra)`, () => {
    // Pratos de três letras são pedidos legítimos.
    expect(searchTermReadiness(' ovo ')).toBe('ok')
    expect(searchTermReadiness('chá')).toBe('ok')
    expect(searchTermReadiness('bolo')).toBe('ok')
    expect(searchTermReadiness('açaí')).toBe('ok')
    expect(searchTermReadiness('feijão tropeiro')).toBe('ok')
  })
})

describe('createFromSearchHref', () => {
  it('termo que serve de pedido ⇒ /create?q=<termo aparado, URL-encoded>', () => {
    expect(createFromSearchHref('  feijão tropeiro ')).toBe('/create?q=feij%C3%A3o%20tropeiro')
  })

  it('sem termo utilizável ⇒ /create cru (sem ?q= espúrio nem "123" pré-preenchido)', () => {
    expect(createFromSearchHref('')).toBe('/create')
    expect(createFromSearchHref('123')).toBe('/create')
    expect(createFromSearchHref('fr')).toBe('/create')
  })

  it('termo enorme é cortado para o destino caber no returnTo do login (<= 512)', () => {
    const href = createFromSearchHref('ç'.repeat(400) + ' 拉面'.repeat(100))
    expect(href.startsWith('/create?q=')).toBe(true)
    expect(href.length).toBeLessThanOrEqual(512)
    // Corta por code point: o que sobra ainda decodifica sem lançar (sem sequência partida).
    expect(() => decodeURIComponent(href.slice('/create?q='.length))).not.toThrow()
  })

  it('se o corte deixa só dígitos, cai no /create cru (mesma regra do "123")', () => {
    expect(createFromSearchHref('1'.repeat(500) + ' pão')).toBe('/create')
  })

  it('termo colado gigante não trava (passada única)', () => {
    const t0 = performance.now()
    createFromSearchHref('ç'.repeat(50_000))
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
