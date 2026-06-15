import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
} from '@/i18n/locale'

describe('resolveLocale — núcleo puro de locale (#4.AC3, T2)', () => {
  it('preferred suportado ganha da detecção', () => {
    expect(resolveLocale({ preferred: 'en-US', acceptLanguage: 'pt-BR' })).toBe('en-US')
    expect(resolveLocale({ preferred: 'pt-BR', acceptLanguage: 'en-US,en;q=0.9' })).toBe('pt-BR')
  })

  it('preferred não suportado é ignorado; cai para a detecção', () => {
    expect(resolveLocale({ preferred: 'fr-FR', acceptLanguage: 'en-US' })).toBe('en-US')
  })

  it('detecta exata: en-US → en-US', () => {
    expect(resolveLocale({ acceptLanguage: 'en-US' })).toBe('en-US')
  })

  it("detecta por base: 'pt' → pt-BR, 'en' → en-US", () => {
    expect(resolveLocale({ acceptLanguage: 'pt' })).toBe('pt-BR')
    expect(resolveLocale({ acceptLanguage: 'en' })).toBe('en-US')
  })

  it('respeita a ordem por q (decrescente)', () => {
    // en tem q maior que pt → en-US ganha, apesar de pt vir primeiro na string.
    expect(resolveLocale({ acceptLanguage: 'pt;q=0.2, en;q=0.9' })).toBe('en-US')
    // pt-BR tem q maior → pt-BR ganha.
    expect(resolveLocale({ acceptLanguage: 'en-US;q=0.3, pt-BR;q=0.8' })).toBe('pt-BR')
  })

  it('locale não suportado → DEFAULT_LOCALE (pt-BR), sem tela quebrada', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR' })).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ acceptLanguage: 'fr-FR,de-DE;q=0.5' })).toBe('pt-BR')
  })

  it('Accept-Language vazio / ausente → DEFAULT_LOCALE', () => {
    expect(resolveLocale({})).toBe('pt-BR')
    expect(resolveLocale({ acceptLanguage: '' })).toBe('pt-BR')
    expect(resolveLocale({ acceptLanguage: null, preferred: null })).toBe('pt-BR')
  })

  it("borda E16: wildcard '*' é ignorado → DEFAULT_LOCALE", () => {
    expect(resolveLocale({ acceptLanguage: '*' })).toBe('pt-BR')
    // wildcard junto de um tag suportado: o suportado ganha.
    expect(resolveLocale({ acceptLanguage: '*;q=0.1, en-US;q=0.9' })).toBe('en-US')
  })

  it("borda E16: ';q=' malformado (Number('abc')=NaN) não crasha", () => {
    // q inválido não derruba o parser; a tag suportada ainda é encontrada.
    expect(resolveLocale({ acceptLanguage: 'en-US;q=abc' })).toBe('en-US')
    expect(resolveLocale({ acceptLanguage: 'pt;q=' })).toBe('pt-BR')
  })

  it("BUG-2: q malformado (NaN) NÃO vence q válido — vira 0 e cai pro fim", () => {
    // en-US tem q inválido (NaN→0); pt-BR tem q válido. pt-BR DEVE ganhar,
    // mesmo vindo depois na string. (Antes, NaN flutuava e en-US vencia.)
    expect(resolveLocale({ acceptLanguage: 'en-US;q=abc, pt-BR;q=0.5' })).toBe('pt-BR')
    // Espelho: pt-BR com q inválido perde para en-US com q válido.
    expect(resolveLocale({ acceptLanguage: 'pt-BR;q=xyz, en-US;q=0.1' })).toBe('en-US')
    // Duas válidas + uma inválida: a inválida não rouba o topo.
    expect(resolveLocale({ acceptLanguage: 'fr;q=oops, en-US;q=0.9, pt-BR;q=0.2' })).toBe('en-US')
  })

  it('BUG-3: detecção é case-insensitive e retorna a forma canônica', () => {
    // Navegadores podem mandar casing arbitrário (RFC 5646 é case-insensitive).
    expect(resolveLocale({ acceptLanguage: 'EN-US' })).toBe('en-US')
    expect(resolveLocale({ acceptLanguage: 'PT-br' })).toBe('pt-BR')
    expect(resolveLocale({ acceptLanguage: 'en-us,pt-br;q=0.5' })).toBe('en-US')
    // Match por base também normaliza o casing.
    expect(resolveLocale({ acceptLanguage: 'EN' })).toBe('en-US')
    expect(resolveLocale({ acceptLanguage: 'PT' })).toBe('pt-BR')
  })

  it('BUG-3: preferred case-insensitive vira a forma canônica', () => {
    expect(resolveLocale({ preferred: 'EN-US' })).toBe('en-US')
    expect(resolveLocale({ preferred: 'pt-br', acceptLanguage: 'en-US' })).toBe('pt-BR')
  })

  it('borda E16: base estranha fr-FR → DEFAULT (não casa nenhuma base suportada)', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR,fr;q=0.8' })).toBe('pt-BR')
  })
})

describe('isSupportedLocale + SUPPORTED_LOCALES', () => {
  it('aceita os suportados e rejeita o resto', () => {
    expect(isSupportedLocale('pt-BR')).toBe(true)
    expect(isSupportedLocale('en-US')).toBe(true)
    expect(isSupportedLocale('fr-FR')).toBe(false)
    expect(isSupportedLocale('pt')).toBe(false) // base não é locale suportado
    expect(isSupportedLocale('')).toBe(false)
  })

  it('BUG-3: é case-insensitive (RFC 5646) — aceita casing alternativo', () => {
    expect(isSupportedLocale('EN-US')).toBe(true)
    expect(isSupportedLocale('pt-br')).toBe(true)
    expect(isSupportedLocale('PT-BR')).toBe(true)
    expect(isSupportedLocale('en-us')).toBe(true)
    // base solta segue rejeitada, independente do casing.
    expect(isSupportedLocale('EN')).toBe(false)
  })

  it('SUPPORTED_LOCALES é exatamente [pt-BR, en-US] e DEFAULT é pt-BR', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['pt-BR', 'en-US'])
    expect(DEFAULT_LOCALE).toBe('pt-BR')
    expect(isSupportedLocale(DEFAULT_LOCALE)).toBe(true)
  })
})
