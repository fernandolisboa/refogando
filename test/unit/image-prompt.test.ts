import { describe, expect, it } from 'vitest'
import { buildDishImagePrompt } from '@/domain/image-prompt'

/** Montagem PURA do prompt de imagem do prato (#132, ADR-0017). */

describe('buildDishImagePrompt', () => {
  it('inclui título, ingredientes e estilo (cozinha/categoria)', () => {
    const p = buildDishImagePrompt({
      titulo: 'Feijoada',
      cozinha: 'brasileira',
      categoria: 'prato_principal',
      ingredientes: ['feijão preto', 'carne seca'],
    })
    expect(p).toContain('Feijoada')
    expect(p).toContain('feijão preto, carne seca')
    expect(p).toContain('brasileira, prato_principal')
  })

  it('omite a seção de ingredientes quando vazia (e ignora rótulos em branco)', () => {
    const p = buildDishImagePrompt({ titulo: 'Água', cozinha: null, categoria: null, ingredientes: ['', '  '] })
    expect(p).toContain('Água')
    expect(p).not.toContain('Ingredientes principais')
    expect(p).not.toContain('Estilo:')
  })

  it('determinístico: mesma entrada ⇒ mesma saída', () => {
    const input = { titulo: 'Bolo', cozinha: 'francesa', categoria: null, ingredientes: ['farinha'] }
    expect(buildDishImagePrompt(input)).toBe(buildDishImagePrompt(input))
  })

  it('trima o título', () => {
    expect(buildDishImagePrompt({ titulo: '  Torta  ', cozinha: null, categoria: null, ingredientes: [] })).toContain('Prato: Torta.')
  })
})
