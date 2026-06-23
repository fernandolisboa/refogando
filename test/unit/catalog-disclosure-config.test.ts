import { describe, expect, it } from 'vitest'
import {
  parseCatalogDisclosureConfig,
  shouldShowCatalogDisclosure,
  DEFAULT_CATALOG_DISCLOSURE_CONFIG,
  DEFAULT_CATALOG_DISCLOSURE_TEXT,
} from '@/domain/catalog-disclosure-config'

/**
 * Config do AVISO de catálogo AI-assistido (#237, SEO #187) — PURO. `parseCatalogDisclosureConfig`
 * valida o PUT do admin; `shouldShowCatalogDisclosure` é a DECISÃO de render (catálogo + ligado).
 * Espelha `web-search-config.test.ts`/`image-gen-config.test.ts`.
 */

describe('defaults', () => {
  it('aviso nasce DESLIGADO com o texto padrão (cortesia opt-in)', () => {
    expect(DEFAULT_CATALOG_DISCLOSURE_CONFIG.enabled).toBe(false)
    expect(DEFAULT_CATALOG_DISCLOSURE_CONFIG.text).toBe(DEFAULT_CATALOG_DISCLOSURE_TEXT)
    // O texto default é uma frase não-vazia em pt-BR.
    expect(DEFAULT_CATALOG_DISCLOSURE_TEXT.trim().length).toBeGreaterThan(0)
  })
})

describe('parseCatalogDisclosureConfig', () => {
  it('válido: enabled boolean + text não-vazio (trimado)', () => {
    expect(parseCatalogDisclosureConfig({ enabled: true, text: '  Em colaboração com a IA.  ' })).toEqual({
      ok: true,
      value: { enabled: true, text: 'Em colaboração com a IA.' },
    })
    expect(parseCatalogDisclosureConfig({ enabled: false, text: 'Texto desligado mas válido' })).toEqual({
      ok: true,
      value: { enabled: false, text: 'Texto desligado mas válido' },
    })
  })

  it('enabled não-boolean ⇒ ok:false', () => {
    expect(parseCatalogDisclosureConfig({ enabled: 'sim', text: 'x' })).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig({ text: 'x' })).toEqual({ ok: false })
  })

  it('text ausente / não-string / vazio / só-espaço ⇒ ok:false', () => {
    expect(parseCatalogDisclosureConfig({ enabled: true })).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig({ enabled: true, text: 42 })).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig({ enabled: true, text: '' })).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig({ enabled: true, text: '   ' })).toEqual({ ok: false })
  })

  it('text acima do teto ⇒ ok:false', () => {
    expect(parseCatalogDisclosureConfig({ enabled: true, text: 'a'.repeat(501) })).toEqual({ ok: false })
  })

  it('não-objeto / array / null ⇒ ok:false', () => {
    expect(parseCatalogDisclosureConfig(null)).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig([])).toEqual({ ok: false })
    expect(parseCatalogDisclosureConfig('texto')).toEqual({ ok: false })
  })
})

describe('shouldShowCatalogDisclosure — decisão de render', () => {
  it('true SÓ para catalog + ligado', () => {
    expect(shouldShowCatalogDisclosure({ origin: 'catalog', enabled: true })).toBe(true)
  })

  it('false quando DESLIGADO, mesmo em catálogo', () => {
    expect(shouldShowCatalogDisclosure({ origin: 'catalog', enabled: false })).toBe(false)
  })

  it('false para QUALQUER origem que não catalog, mesmo ligado', () => {
    // INEGOCIÁVEL: o aviso é editorial do Catálogo — NÃO aparece (nem substitui o selo obrigatório)
    // em receitas geradas/editadas por IA ou importadas.
    for (const origin of ['ai_chat', 'ai_structured', 'ai_free_text', 'user_edited', 'web_imported']) {
      expect(shouldShowCatalogDisclosure({ origin, enabled: true })).toBe(false)
    }
  })
})
