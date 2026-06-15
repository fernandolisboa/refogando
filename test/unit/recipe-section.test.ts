import { describe, expect, it } from 'vitest'
import { ORIGENS, classifySection } from '@/domain/recipe'

// ── classifySection — tabela-verdade da seção da Busca (#6) ────────────────────

describe('classifySection — Catálogo vs. Comunidade por origin', () => {
  it('catalog ⇒ catalogo', () => {
    expect(classifySection('catalog')).toBe('catalogo')
  })

  it('todo origin não-catalog ⇒ comunidade', () => {
    expect(classifySection('ai_chat')).toBe('comunidade')
    expect(classifySection('ai_structured')).toBe('comunidade')
    expect(classifySection('user_edited')).toBe('comunidade')
  })

  it('tabela-verdade completa sobre ORIGENS (sem origin não classificado)', () => {
    for (const origin of ORIGENS) {
      const section = classifySection(origin)
      expect(section).toBe(origin === 'catalog' ? 'catalogo' : 'comunidade')
      // Total: cada origin cai em exatamente uma das duas seções.
      expect(['catalogo', 'comunidade']).toContain(section)
    }
  })
})
