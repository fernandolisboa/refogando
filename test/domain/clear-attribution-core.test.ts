import { describe, it, expect } from 'vitest'
import { hasRemovableSourceName } from '@/server/recipe/clear-attribution'

/**
 * Núcleo PURO da decisão "há um nome de fonte HUMANO a remover?" (#272/#396) — fonte ÚNICA reusada
 * pelo self-service (`clearSourceAttribution`) E pelo fluxo do operador (`operatorClearSourceAttribution`,
 * GAP-4). Sem DB: só a regra web_imported + com URL + nome ≠ host (via `sourceNameIsHost`).
 */
describe('hasRemovableSourceName (#396 GAP-4 — núcleo compartilhado)', () => {
  it('web_imported + URL + nome humano ≠ host → true (há nome a remover)', () => {
    expect(
      hasRemovableSourceName({
        origin: 'web_imported',
        sourceName: 'Cozinha da Vovó',
        sourceUrl: 'https://exemplo.com/r',
      }),
    ).toBe(true)
  })

  it('nome que JÁ é o host (fallback www) → false (no-op, nada humano)', () => {
    expect(
      hasRemovableSourceName({
        origin: 'web_imported',
        sourceName: 'www.exemplo.com',
        sourceUrl: 'https://www.exemplo.com/r',
      }),
    ).toBe(false)
  })

  it('sem nome → false; sem URL → false (paridade com o botão)', () => {
    expect(
      hasRemovableSourceName({ origin: 'web_imported', sourceName: null, sourceUrl: 'https://x.com' }),
    ).toBe(false)
    expect(
      hasRemovableSourceName({ origin: 'web_imported', sourceName: 'Chef', sourceUrl: null }),
    ).toBe(false)
  })

  it('origin não-importada → false mesmo com nome + URL', () => {
    expect(
      hasRemovableSourceName({
        origin: 'ai_structured',
        sourceName: 'Chef',
        sourceUrl: 'https://exemplo.com/r',
      }),
    ).toBe(false)
  })
})
