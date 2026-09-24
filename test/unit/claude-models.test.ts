import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_MODEL,
  FALLBACK_SELECTABLE_MODELS,
  latestPerFamily,
  selectableFamilyOf,
  type CatalogModel,
} from '@/domain/claude-models'
import { loadSelectableModels } from '@/server/claude/model-catalog'

const m = (id: string, createdAt: string): CatalogModel => ({ id, displayName: id, createdAt })

describe('selectableFamilyOf', () => {
  it('reconhece Opus, Sonnet e Fable; Haiku, Mythos e lixo ficam de fora', () => {
    expect(selectableFamilyOf('claude-opus-5-5')).toBe('opus')
    expect(selectableFamilyOf('claude-sonnet-5')).toBe('sonnet')
    expect(selectableFamilyOf('claude-fable-5-1')).toBe('fable')
    expect(selectableFamilyOf('claude-haiku-4-5')).toBeNull()
    expect(selectableFamilyOf('claude-mythos-5-1')).toBeNull()
    expect(selectableFamilyOf('gpt-4')).toBeNull()
  })
})

describe('latestPerFamily', () => {
  it('fica com o mais novo de cada família, na ordem opus → sonnet → fable, independente da ordem de entrada', () => {
    const out = latestPerFamily([
      m('claude-sonnet-4-6', '2026-02-01T00:00:00Z'),
      m('claude-opus-4-8', '2026-04-01T00:00:00Z'),
      m('claude-fable-5', '2026-05-15T00:00:00Z'),
      m('claude-opus-5-5', '2026-08-10T00:00:00Z'),
      m('claude-haiku-4-5', '2026-09-01T00:00:00Z'),
      m('claude-sonnet-5', '2026-05-01T00:00:00Z'),
      m('claude-fable-5-1', '2026-08-20T00:00:00Z'),
    ])
    expect(out.map((o) => o.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1'])
    expect(out.map((o) => o.family)).toEqual(['opus', 'sonnet', 'fable'])
  })

  it('família ausente na lista fica de fora; lista vazia ⇒ []', () => {
    expect(latestPerFamily([m('claude-opus-5-5', '2026-08-10T00:00:00Z')]).map((o) => o.id)).toEqual([
      'claude-opus-5-5',
    ])
    expect(latestPerFamily([])).toEqual([])
  })

  it('data inválida não vence uma data válida', () => {
    const out = latestPerFamily([m('claude-opus-x', 'lixo'), m('claude-opus-5-5', '2026-08-10T00:00:00Z')])
    expect(out[0].id).toBe('claude-opus-5-5')
  })
})

describe('loadSelectableModels', () => {
  it('erro da Models API ⇒ lista pinada', async () => {
    const out = await loadSelectableModels({
      listModels: async () => {
        throw new Error('sem chave')
      },
    })
    expect(out).toEqual(FALLBACK_SELECTABLE_MODELS)
  })

  it('lista sem nenhuma família nossa ⇒ lista pinada', async () => {
    const out = await loadSelectableModels({ listModels: async () => [m('claude-haiku-4-5', '2026-01-01T00:00:00Z')] })
    expect(out).toEqual(FALLBACK_SELECTABLE_MODELS)
  })

  it('o default em código é selecionável no fallback', () => {
    expect(FALLBACK_SELECTABLE_MODELS.some((o) => o.id === DEFAULT_TEXT_MODEL)).toBe(true)
  })
})
